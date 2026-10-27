# Instruction set

The language Mica's CPU runs: the machine, the syntax, all 33 instructions, the errors, the helpers for writing your own instructions, and the 38 commands of the System and Hybrid tabs.

## Contents

1. [The machine](#the-machine)
2. [Writing assembly](#writing-assembly)
3. [Instructions](#instructions)
4. [Flags and comparisons](#flags-and-comparisons)
5. [The stack and subroutines](#the-stack-and-subroutines)
6. [Errors](#errors)
7. [Writing your own instructions](#writing-your-own-instructions)
8. [System commands](#system-commands)

## The machine

| Part | Details |
| --- | --- |
| `R1`, `R2`, `R3`, `R4` | general-purpose registers, 0 after a reset |
| `PC` | the program counter: the number of the next instruction, counting from 0 |
| `SP` | the stack pointer: 1023 (`0x3FF`) after a reset; the stack grows down |
| `ZF`, `SF` | the flags: zero, and sign (negative) |
| Memory | 1,024 cells, addresses 0 to 1023 (`0x000`–`0x3FF`) |

The program does not live in memory. Instructions are numbered from 0 in the order they appear, and the PC, labels and jumps count instructions, not memory cells. Memory holds data and the stack.

A memory cell holds a 32-bit signed whole number: a value written to memory is truncated to one. Registers hold whatever the arithmetic produces, without wrapping. The grid and the hexadecimal display show a cell's low byte.

## Writing assembly

```asm
; a comment runs to the end of the line
        MOV R1, 10      ; operands are separated by a comma or a space
loop:                   ; a label names the next instruction
        OUT R1
        DEC R1
        JNZ loop
done:   HLT             ; a label can share a line with its instruction
```

- **One instruction per line.** Indentation is free. Names of instructions, registers and labels are not case-sensitive.
- **A label** is a name followed by a colon, alone on its line or before an instruction. It stands for the number of the instruction that follows it. Jumps and `CALL` take labels, and so does any source operand: `MOV R1, done` puts the instruction number of `done` in R1.
- **Literals** are decimal (`42`, `-3`), hexadecimal (`0xFF`, `-0x10`) or binary (`0b1010`).
- **Indirect operands**, `[x]`, mean the memory cell at address `x`, where `x` is a register, `PC`, `SP`, a literal or a label: `[R2]`, `[0x40]`, `[SP]`. They work as sources and as destinations, so `MOV [R2], 7` writes memory.
- **`PC` and `SP`** can be read like registers, and written.

With *Syntax check* on, the editor marks an unknown instruction or a wrong number of operands as you type. Unknown operands, such as a misspelt label, are reported when the instruction runs.

## Instructions

`dst` is a register, `PC`, `SP` or `[x]`; `src`, `a`, `b` and `n` are any operand; `label` is a label or any operand that gives an instruction number. The **Flags** column says whether the instruction sets ZF and SF from its result.

### Data movement

| Instruction | Effect | Flags | Notes |
| --- | --- | --- | --- |
| `MOV dst, src` | dst = src | – | src can be a register, a literal, a label or `[addr]` |
| `LOAD reg, addr` | reg = memory[addr] | – | reads the cell at address `addr` |
| `STORE addr, src` | memory[addr] = src | – | writes the cell at address `addr` |

`LOAD R1, 100` and `MOV R1, [100]` do the same thing, as do `STORE 100, R1` and `MOV [100], R1`.

### Arithmetic

| Instruction | Effect | Flags | Notes |
| --- | --- | --- | --- |
| `ADD dst, src` | dst = dst + src | ✓ | |
| `SUB dst, src` | dst = dst − src | ✓ | |
| `MUL dst, src` | dst = dst × src | ✓ | |
| `DIV dst, src` | dst = dst ÷ src | ✓ | rounds toward zero; dividing by zero crashes with the ÷0 guard on, and gives 0 with it off |
| `MOD dst, src` | dst = dst mod src | ✓ | the remainder has the sign of dst; zero follows the ÷0 guard |
| `INC dst` | dst = dst + 1 | ✓ | |
| `DEC dst` | dst = dst − 1 | ✓ | |

### Bitwise

These work on 32-bit two's-complement integers.

| Instruction | Effect | Flags | Notes |
| --- | --- | --- | --- |
| `AND dst, src` | dst = dst & src | ✓ | |
| `OR dst, src` | dst = dst \| src | ✓ | |
| `XOR dst, src` | dst = dst ^ src | ✓ | |
| `NOT dst` | dst = ~dst | ✓ | flips every bit, so `NOT` of 0 is −1 |
| `SHL dst, n` | dst = dst << n | ✓ | shift left by n bits |
| `SHR dst, n` | dst = dst >> n | ✓ | arithmetic shift right: the sign is kept |

### Compare and jump

| Instruction | Jumps when | Flags | Notes |
| --- | --- | --- | --- |
| `CMP a, b` | – | ✓ | sets the flags from a − b and writes nothing |
| `JMP label` | always | – | |
| `JEQ label` | ZF is set | – | alias `JZ` |
| `JNE label` | ZF is clear | – | alias `JNZ` |
| `JLT label` | SF is set | – | |
| `JGE label` | SF is clear | – | |
| `JGT label` | SF and ZF are clear | – | |
| `JLE label` | SF or ZF is set | – | |

### Stack

| Instruction | Effect | Flags | Notes |
| --- | --- | --- | --- |
| `PUSH src` | memory[SP] = src, then SP − 1 | – | crashes with *Stack overflow* below address 0 |
| `POP dst` | SP + 1, then dst = memory[SP] | – | crashes with *Stack underflow* on an empty stack |
| `CALL label` | push PC + 1, then jump | – | |
| `RET` | pop into PC | – | returns to the instruction after the `CALL` |

### Input and output

| Instruction | Effect | Flags | Notes |
| --- | --- | --- | --- |
| `OUT src` | prints src as a decimal number on its own line | – | |
| `OUTC src` | prints the character whose code is src's low byte | – | 10 starts a new line; 0 prints nothing |
| `IN dst` | waits for a value typed in the TTY, then stores it in dst | – | accepts `42`, `-7`, `0x2A`, `0b101`, `A` or `'A'` |

### Control

| Instruction | Effect | Flags |
| --- | --- | --- |
| `NOP` | nothing | – |
| `HLT` | halts the CPU | – |

## Flags and comparisons

Every arithmetic and bitwise instruction, and `CMP`, sets **ZF** when its result is 0 and **SF** when its result is negative. `MOV`, `LOAD`, `STORE`, the stack instructions and input and output leave the flags alone.

After `CMP a, b`, which looks at a − b, the conditional jumps read like comparisons:

| To jump when | Use |
| --- | --- |
| a = b | `JEQ` (`JZ`) |
| a ≠ b | `JNE` (`JNZ`) |
| a < b | `JLT` |
| a ≥ b | `JGE` |
| a > b | `JGT` |
| a ≤ b | `JLE` |

`DEC R1` followed by `JNZ loop` is the classic countdown: it loops until R1 reaches zero.

## The stack and subroutines

The stack starts at the top of memory and grows down: `PUSH` writes at SP and then moves it down one cell, `POP` moves it up and reads. In the memory grid, the stack's cells are tinted and SP's cell is outlined.

`CALL` pushes the number of the instruction after it and jumps; `RET` pops that number into the PC. The examples pass arguments in R1 and R2 and return the result in R1, and the kernel's routines leave R3 and R4 as they found them. A recursive routine keeps what it still needs on the stack:

```asm
MOV R1, 5
CALL fact
OUT R1          ; 120
HLT

fact:           ; R1 = R1!
CMP R1, 1
JLE base
PUSH R1
DEC R1
CALL fact
POP R2
MUL R1, R2
base:
RET
```

## Errors

An instruction that cannot complete crashes the CPU: the status reads CRASHED, the TTY shows `× line N:` and the message, and a notice repeats it.

| Message | Cause |
| --- | --- |
| `Unknown instruction "X"` | the line's first word is not an instruction |
| `Cannot resolve "X"` | an operand is not a register, a label or a number, often a misspelt label |
| `Missing operand`, `Missing destination`, `Missing jump target` | too few operands |
| `Cannot write to "X"` | the destination is not a register, `PC`, `SP` or `[x]` |
| `Memory read out of range: N`, `Memory write out of range: N` | an address outside 0–1023 |
| `Division by zero`, `Modulo by zero` | `DIV` or `MOD` by 0 with the ÷0 guard on |
| `Stack overflow`, `Stack overflow on CALL` | `PUSH` or `CALL` with SP below 0: usually runaway recursion |
| `Stack underflow`, `Stack underflow on RET` | `POP` or `RET` with nothing on the stack |

A program that runs past its last instruction, or jumps outside it, halts with HALTED · PC OUT OF RANGE. End programs with `HLT`.

## Writing your own instructions

In the CPU tab every instruction is a JavaScript function you can edit and apply while the machine runs. `INC`, for example, is:

```js
function INC(dst) {
  const r = read(dst) + 1;
  write(dst, r);
  setFlags(r);
}
```

The function receives the instruction's operands as text (`'R1'`, `'[0x40]'`, `'loop'`) and can use these names:

| Name | What it does |
| --- | --- |
| `read(x)` | the value of an operand: a register, `PC`, `SP`, a label, a literal or `[addr]` |
| `write(dst, v)` | stores v in a register, `PC`, `SP` or `[addr]` |
| `writeReg(name, v)` | stores v in `R1`–`R4`, `PC` or `SP` |
| `writeMem(addr, v)` | stores v in a memory cell, with the RAM beep and the last-write highlight |
| `setFlags(r)` | sets ZF and SF from a result |
| `jump(target)` | sets the PC to a label or an instruction number, and returns `true` |
| `print(v)` | prints a line in the TTY |
| `printChar(c)` | prints one character |
| `requestInput(dst)` | asks the TTY for a value and stores it in dst |
| `halt()` | halts the CPU |
| `cpu` | the machine: `cpu.registers.R1`, `cpu.pc`, `cpu.sp`, `cpu.flags.ZF`, `cpu.memory[addr]` |
| `MEM_SIZE` | 1024 |
| `S` | the settings, such as `S.divZero` for the ÷0 guard |

After the function returns, the CPU moves on to the next instruction, unless the function returns `true`, which means it set the PC itself, as the jumps do. Throwing an `Error` crashes the CPU with its message. This `OUT` prints in hexadecimal:

```js
function OUT(src) {
  print('0x' + read(src).toString(16).toUpperCase());
}
```

A patch lasts until the page is reloaded. **Reset** in the instruction's card restores the original.

## System commands

The System tab runs these one per line; the Hybrid tab runs them between blocks of assembly. They are not case-sensitive, numbers can be decimal, hex or binary, and `;` starts a comment. Commands that take `on|off` also accept `toggle`, which is what they do with no argument.

### The machine

| Command | What it does |
| --- | --- |
| `SET reg value` | sets a register: `R1`–`R4`, `PC` or `SP` |
| `FLAG ZF\|SF 0\|1` | sets a flag |
| `MEM addr value` | writes one memory cell |
| `PEEK addr` | reads one memory cell |
| `FILL start end value` | fills a range of cells |
| `DUMP addr [count]` | shows `count` cells (16 by default, at most 256) in hex, 16 to a line |
| `RUN` | starts or resumes the CPU |
| `PAUSE` | pauses it |
| `STEP [n]` | runs n instructions (1 by default, at most 1000) |
| `RESET` | resets the CPU, memory and TTY |

### Clocks and pace

| Command | What it does |
| --- | --- |
| `CLOCK [asm\|host\|hybrid] ms` | sets the clock, for the active tab or the one named |
| `CLOCKSEP on\|off` | each tab has its own clock (on) or they share one (off) |
| `CLOCKAUTO on\|off` | switching tabs applies that tab's clock |
| `DEFCLOCK ms` | the default clock, applied now and at every start |
| `PACE host\|hybrid ms` | the delay between script lines, independent of the CPU |
| `WAIT ms` | pauses the script, up to 10 seconds |

### Output and JavaScript

| Command | What it does |
| --- | --- |
| `PRINT text…` | writes the text to the log |
| `TTY text…` | writes the text into the machine's TTY |
| `JS expression…` | evaluates JavaScript on the host, with `cpu` in scope, and logs the result |
| `HELP` | lists every command |

### Settings and the window

| Command | What it does |
| --- | --- |
| `THEME light\|dark\|toggle` | the theme |
| `MOTION auto\|reduce\|full` | the animation preference |
| `TIPS on\|off` | hover info |
| `BASE dec\|hex\|toggle` | the display base |
| `GUARD on\|off` | the ÷0 guard |
| `LINT on\|off` | the syntax check |
| `STRICT on\|off` | strict run |
| `LIVE on\|off` | live program |
| `SOUND off\|sine\|square\|triangle\|sawtooth\|custom` | the RAM beep's waveform |
| `VOLUME 0–100` | its volume |
| `MUTE on\|off` | mutes it |
| `PITCH 50–2000` | its base frequency, in Hz |
| `BEEP byte` | plays it once, if a sound is on |
| `SOUNDFILE pick\|clear` | chooses or removes a custom beep sample |
| `BACKDROP pick\|clear\|url <link>` | chooses, removes or links a backdrop image |
| `PIN name on\|off` | pins a control to the footer: `theme`, `sound`, `volume`, `pitch`, `divZero`, `base`, `lint`, `strict` or `clock` |
| `FLOAT editor\|machine\|manual` | lifts a panel out of the grid |
| `SNAP editor\|machine\|manual\|all` | puts panels back in the grid |

`JS` runs any JavaScript you give it, in the page, so it can do anything a script in the page can. `JS cpu.memory.slice(0, 8)` and `JS cpu.registers` are handy for a look at the machine.
