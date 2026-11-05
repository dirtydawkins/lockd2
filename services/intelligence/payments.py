"""Durable sandbox reconciliation. Never changes bookings or moves money."""
import hashlib

import paystack
from persona import IntegrationUnavailable, InvalidProviderResult, database_rpc


def receive(raw):
    reference = paystack.webhook_reference(raw)
    if reference is None:
        return {'received': True, 'queued': False}
    result = database_rpc('enqueue_lockd_test_payment_event', {
        'p_reference': reference, 'p_sha256': hashlib.sha256(raw).hexdigest()})
    return {'received': True, 'queued': result.get('queued') is True}


def reconcile_one():
    if not paystack.reconciliation_enabled():
        raise IntegrationUnavailable()
    job = database_rpc('claim_lockd_test_payment_event', {})
    if job is None:
        return {'state': 'idle', 'environment': 'test', 'booking_authorized': False}
    try:
        result = paystack.verify_transaction(job['reference'])
        outcome = database_rpc('finish_lockd_test_payment_event', {
            'p_id': job['id'], 'p_lease': job['lease'], 'p_reference': result['reference'],
            'p_provider_id': result['provider_id'], 'p_amount_minor': result['amount_minor'],
            'p_currency': result['currency'], 'p_status': result['status']})
        return {'state': outcome['state'], 'environment': 'test', 'booking_authorized': False}
    except (IntegrationUnavailable, InvalidProviderResult):
        # GET verification can safely retry; it never creates a second charge.
        database_rpc('retry_lockd_test_payment_event', {'p_id': job['id'], 'p_lease': job['lease']})
        return {'state': 'retry_scheduled', 'environment': 'test', 'booking_authorized': False}
