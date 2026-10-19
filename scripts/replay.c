#include <stdio.h>
#include <stdlib.h>

static unsigned next_input(void) {
    static unsigned index = 0;
    char name[32];
    snprintf(name, sizeof(name), "CEGAR_INPUT_%u", index++);
    const char *value = getenv(name);
    if (!value) { fputs("Missing replay input\n", stderr); exit(2); }
    return (unsigned)strtoul(value, NULL, 10);
}
int nondet_int(void) { return (int)next_input(); }
unsigned nondet_uint(void) { return next_input(); }
void ERROR(void) { puts("ERROR reached"); exit(42); }
