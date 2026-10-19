extern int nondet_int(void);
extern void ERROR(void);

int main(void) {
    int x = nondet_int();
    int y = nondet_int();
    if (x > 0) {
        if (x <= 0) ERROR();
    }
    if (y > 10) {
        if (y <= 10) ERROR();
    }
    return 0;
}
