---- MODULE two_refinements_M0 ----
EXTENDS TLC

\* Recorded abstract model; pc denotes a displayed block end.
\* Straight-line steps collapsed. Predicates describe immutable inputs.

VARIABLES pc
vars == <<pc>>

Init ==
    /\ pc = "entry"

Step(from, to, enabled) ==
    /\ pc = from
    /\ enabled
    /\ pc' = to

Next ==
    \/ Step("entry", "test x > 0", TRUE)
    \/ Step("test x > 0", "test x <= 0", TRUE)
    \/ Step("test x > 0", "test y > 10", TRUE)
    \/ Step("test x <= 0", "error after x <= 0", TRUE)
    \/ Step("test x <= 0", "test y > 10", TRUE)
    \/ Step("test y > 10", "test y <= 10", TRUE)
    \/ Step("test y > 10", "return", TRUE)
    \/ Step("test y <= 10", "error after y <= 10", TRUE)
    \/ Step("test y <= 10", "return", TRUE)

TypeOK ==
    /\ pc \in {"entry", "test x > 0", "test x <= 0", "error after x <= 0", "test y > 10", "test y <= 10", "return", "error after y <= 10"}

NoError == pc \notin {"error after x <= 0", "error after y <= 10"}

Spec == Init /\ [][Next]_vars
====
