# Migration naming

Prisma applies migrations in **lexicographic order of directory name**, not
numeric order. `10_x` therefore sorts between `0_x` and `1_x`, which would run
it long before the tables it depends on exist.

The numeric prefixes here stop at `9_`. Anything after it continues with a
letter suffix — `9a_`, `9b_`, … — because `_` (0x5F) sorts before `a` (0x61),
so `9a_` lands after `9_` and after every earlier number. The sequence
currently runs to `9h_`; a single letter gives room to `9z_`, and past that
the squash below is the answer rather than `9aa_`.

The already-applied names are **not** renumbered: deployed databases record
applied migrations by name in `_prisma_migrations`, so renaming one makes
Prisma treat it as new and try to apply it over existing tables on the next
deploy.

If the sequence ever outgrows this, switch new migrations to Prisma's
timestamp convention only once every numeric-prefixed migration has been
squashed into a fresh baseline.
