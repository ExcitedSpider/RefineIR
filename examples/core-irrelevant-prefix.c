extern int nondet_int(void);
extern void ERROR(void);
int main(void) {
    int noise = nondet_int();
    int x = nondet_int();
    if (noise > 100) {
        if (x > 0) {
            if (x <= 0) ERROR();
        }
    }
    return 0;
}
