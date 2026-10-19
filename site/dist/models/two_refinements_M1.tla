---- MODULE two_refinements_M1 ----
EXTENDS TLC

\* Recorded abstract model; pc denotes a displayed block end.
\* Straight-line steps collapsed. Predicates describe immutable inputs.
\* p0 represents: x > 0

VARIABLES pc, p0
vars == <<pc, p0>>

Init ==
    /\ pc = "entry"
    /\ <<p0>> \in {<<FALSE>>, <<TRUE>>}

Step(from, to, enabled) ==
    /\ pc = from
    /\ enabled
    /\ pc' = to
    /\ UNCHANGED <<p0>>

Next ==
    \/ Step("entry", "test x > 0", TRUE)
    \/ Step("test x > 0", "test x <= 0", p0)
    \/ Step("test x > 0", "test y > 10", ~p0)
    \/ Step("test x <= 0", "error after x <= 0", FALSE)
    \/ Step("test x <= 0", "test y > 10", p0)
    \/ Step("test y > 10", "test y <= 10", TRUE)
    \/ Step("test y > 10", "return", TRUE)
    \/ Step("test y <= 10", "error after y <= 10", TRUE)
    \/ Step("test y <= 10", "return", TRUE)

TypeOK ==
    /\ pc \in {"entry", "test x > 0", "test x <= 0", "error after x <= 0", "test y > 10", "test y <= 10", "return", "error after y <= 10"}
    /\ p0 \in BOOLEAN

NoError == pc \notin {"error after x <= 0", "error after y <= 10"}

Spec == Init /\ [][Next]_vars
====
