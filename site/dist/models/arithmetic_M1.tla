---- MODULE arithmetic_M1 ----
EXTENDS TLC

\* Recorded abstract model; pc denotes a displayed block end.
\* Straight-line steps collapsed. Predicates describe immutable inputs.
\* p0 represents: x <u 10
\* p1 represents: (x + 1) >u 20

VARIABLES pc, p0, p1
vars == <<pc, p0, p1>>

Init ==
    /\ pc = "entry"
    /\ <<p0, p1>> \in {<<FALSE, FALSE>>, <<TRUE, FALSE>>, <<FALSE, TRUE>>}

Step(from, to, enabled) ==
    /\ pc = from
    /\ enabled
    /\ pc' = to
    /\ UNCHANGED <<p0, p1>>

Next ==
    \/ Step("entry", "compute y", ~p1 \/ ~p0)
    \/ Step("compute y", "test x < 10", ~p1 \/ ~p0)
    \/ Step("test x < 10", "test y > 20", (p0 /\ ~p1))
    \/ Step("test x < 10", "return", ~p0)
    \/ Step("test y > 20", "error after y > 20", FALSE)
    \/ Step("test y > 20", "return", (p0 /\ ~p1))

TypeOK ==
    /\ pc \in {"entry", "compute y", "test x < 10", "test y > 20", "return", "error after y > 20"}
    /\ p0 \in BOOLEAN
    /\ p1 \in BOOLEAN

NoError == pc \notin {"error after y > 20"}

Spec == Init /\ [][Next]_vars
====
