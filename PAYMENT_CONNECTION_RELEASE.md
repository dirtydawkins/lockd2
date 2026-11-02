# Payment connections - 2 November 2026

Continues the existing LOCKD marketplace and Render Free service. No customer
payment collection, fabricated records, new resources or paid plans.

## Implementation

- Added private `POST /v1/integrations/paystack/check`, protected by the existing
  service bearer token, body limit and rate limit.
- The adapter accepts only `PAYSTACK_ENVIRONMENT=test` and a test secret key in
  `PAYSTACK_SECRET_KEY`. It calls only the fixed HTTPS Paystack GET
  `/integration/payment_session_timeout` endpoint, using the existing transport's
  timeout, response-size cap and redirect refusal. No customer/payment endpoint
  is invoked and raw responses and credentials are not returned or logged.
- Startup and authenticated capability responses distinguish saved credentials
  from successful authorization. Payment collection remains disabled.
- Daraja and Paystack checks reset their authorization flag before a new check,
  so a failed check cannot leave a previous success in the service status.
- Service environment examples and CI include the new adapter and read-only checks.

## Verification

- `npm test`: all 15 read-only marketplace checks passed.
- `scripts/check-payment-integrations.py`: four checks passed, including actual
  local ASGI health/protected-route behavior, refusal without credentials, source
  boundaries and clearing an old authorization flag on failure. No provider
  responses were mocked and no business records were created.
- Changed Python files compiled successfully. `git diff --check` passed.
- Render shows all three saved Daraja setting names. The environment value was
  checked privately as exactly `sandbox`; credential values were not printed.
- Paystack sign-in is open for the user in the inbuilt browser. Account creation,
  test-key configuration and actual Paystack authorization are still pending.
- Actual provider authorization, release commit and deployment status must be
  recorded below only after observed. These checks do not verify checkout,
  callbacks, settlement, refunds, payouts or booking confirmation.

## References

- https://paystack.com/docs/api/authentication/
- https://paystack.com/docs/api/integration/
