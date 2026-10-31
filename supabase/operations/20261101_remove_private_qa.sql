-- Permanent cleanup of ONLY the named synthetic private-schema concurrency test.
-- Requires action-time approval. Never substitute public or auth here.
begin;
drop schema lockd_qa_20261101_ab3f cascade;
select to_regnamespace('lockd_qa_20261101_ab3f') is null as qa_removed;
commit;
