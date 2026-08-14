-- Adds the RECRUITING application kind.
--
-- On its own, and deliberately. Postgres will not let a newly added enum value
-- be *used* in the transaction that adds it, so the CHECK in the next
-- migration — which names 'RECRUITING' — has to run after this one commits.
-- Merging the two produces "unsafe use of new value" on deploy and nowhere
-- else, which is the worst place to find out.
ALTER TYPE "AccessRequestKind" ADD VALUE 'RECRUITING';
