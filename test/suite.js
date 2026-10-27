/* Mica's functional test suite.

   It runs inside mica.html and drives the app the way a person would: it
   clicks buttons, types into fields and presses keys, then reads the result
   back from the page. Nothing reaches into the app's internals, so a check
   only passes when the visible interface works.

   test/run.mjs injects it into a fresh page (no saved settings) and calls
   __micaTests(), which resolves to { passed, failed, results }. */
async function __micaTests() {
  const byId = id => document.getElementById(id);
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
  const press = (el, key, opts = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts }));
  const until = async (fn, ms = 5000) => {
    const t0 = performance.now();
    for (;;) {
      let v = false;
      try { v = fn(); } catch (e) { /* not there yet */ }
      if (v) return v;
      if (performance.now() - t0 > ms) return false;
      await sleep(15);
    }
  };
  const status = () => byId('statusText').textContent;
  const tty = () => byId('console').textContent;
  /* OUT lines: "› 42" (the TTY also shows "› awaiting input → R1" lines, which are not output) */
  const outputs = () => tty().split('\n').map(l => /^› (-?\d+)$/.exec(l)).filter(Boolean).map(m => m[1]);
  const reg = name => $$('#regs .reg').find(c => $('.reg-k', c).textContent === name);
  const regValue = name => $('.reg-v', reg(name)).textContent;
  const editorTab = name => $(`[data-tabs="editor"] [data-tab="${name}"]`).click();
  const machineTab = name => $(`[data-tabs="machine"] [data-tab="${name}"]`).click();
  const setField = (el, value) => { el.value = String(value); fire(el, 'input'); fire(el, 'change'); };
  const ctrl = key => $(`#settingsBody [data-ctrl="${key}"]`);

  /* A fresh program in the Assembly tab, the CPU reset and the clock at instant. */
  function load(text, clock = 0) {
    editorTab('asm');
    const ed = byId('asmEditor');
    ed.value = text;
    fire(ed, 'input');
    setField(byId('clockAsmNum'), clock);
    byId('btnReset').click();
  }
  async function runToEnd(text) {
    load(text);
    byId('btnRun').click();
    await until(() => /HALTED|CRASHED/.test(status()));
    return outputs();
  }
  async function type(text) {
    const input = byId('ttyInput');
    if (!await until(() => !input.disabled)) throw new Error('the TTY never asked for input');
    input.value = text;
    press(input, 'Enter');
    await sleep(0);
  }
  async function hostScript(text) {
    editorTab('host');
    setField(byId('hostPaceNum'), 0);
    const ed = byId('hostEditor');
    ed.value = text;
    fire(ed, 'input');
    byId('hostOutput').textContent = '';
    byId('btnHostRun').click();
    await until(() => !byId('btnHostRun').disabled);
    return byId('hostOutput').textContent;
  }
  async function openDrawer(open) {
    if (open === !byId('settingsDrawer').hidden) return;
    if (open) byId('settingsToggle').click(); else byId('settingsClose').click();
    await until(() => byId('settingsDrawer').hidden === !open, 1500);
  }

  const results = [];
  const check = async (name, fn) => {
    try {
      await fn();
      results.push({ name, ok: true });
    } catch (e) {
      results.push({ name, ok: false, detail: String(e && e.message || e) });
    }
  };
  const expect = (cond, detail) => { if (!cond) throw new Error(detail); };
  const same = (got, want, what) => expect(JSON.stringify(got) === JSON.stringify(want), `${what}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);

  await until(() => !document.documentElement.classList.contains('preload'), 3000);
  await sleep(250);

  /* ---- start-up ---------------------------------------------------------- */
  await check('starts ready, with every part built', async () => {
    same(status(), 'READY', 'status');
    same($$('#regs .reg').map(c => $('.reg-k', c).textContent), ['PC', 'SP', 'R1', 'R2', 'R3', 'R4'], 'registers');
    expect(byId('memCanvas').width > 0 && byId('memCanvas').height > 0, 'the memory grid has no size');
    expect($$('#refScroll .ref-op').length >= 37, 'the manual lists too few entries');
    same(byId('opsCount').textContent, '33 ops', 'op count chip');
    expect($$('#settingsBody .srow').length >= 17, 'the settings drawer is missing rows');
    expect(/^\d+\.\d+\.\d+$/.test($('.foot-brand .ver').textContent), 'the footer shows no version');
  });
  await check('opens on the counter example', async () => {
    same(byId('exampleSelect').value, 'counter', 'example menu');
    expect(byId('asmEditor').value.startsWith('; count from 1 to 5'), 'the editor does not hold the counter example');
  });

  /* ---- the examples ------------------------------------------------------ */
  /* name: [the program's first line, what it prints] */
  const EXPECTED = {
    counter: ['; count from 1 to 5', ['1', '2', '3', '4', '5']],
    fibonacci: ['; print first 10 Fibonacci numbers', ['0', '1', '1', '2', '3', '5', '8', '13', '21', '34']],
    factorial: ['; recursive factorial: computes 5!', ['120']],
    multiply: ['; multiply R1 * R2 via repeated addition', ['42']],
    memory: ['; write three values into RAM', ['10', '20', '30', '20']],
    bitwise: ['; bitwise ops demo', ['8', '14', '6', '48']],
  };
  for (const [name, [first, want]] of Object.entries(EXPECTED)) {
    await check(`example "${name}" prints the right numbers`, async () => {
      editorTab('asm');
      setField(byId('clockAsmNum'), 0);
      setField(byId('exampleSelect'), name);
      await until(() => byId('asmEditor').value.startsWith(first));
      same(byId('exampleSelect').value, name, 'example menu');
      byId('btnRun').click();
      await until(() => status() === 'HALTED');
      same(status(), 'HALTED', 'status');
      same(outputs(), want, 'output');
    });
  }
  await check('the kernel unpacks, boots, answers commands and quits on q', async () => {
    setField(byId('exampleSelect'), 'kernel');
    await until(() => byId('asmEditor').value.includes('MSH — Mica Shell v1'));
    same(byId('exampleSelect').value, 'kernel', 'example menu');
    setField(byId('clockAsmNum'), 0);
    byId('btnRun').click();
    await until(() => status() === 'AWAITING INPUT');
    expect(tty().includes('MSH - Mica Shell v1'), 'no banner on the TTY');
    expect(tty().includes('msh> '), 'no msh> prompt');
    await type('+');
    await type('2');
    await type('40');
    await until(() => tty().includes('= 42'));
    expect(tty().includes('= 42'), 'MSH did not add 2 + 40');
    await type('q');
    await until(() => status() === 'HALTED');
    same(status(), 'HALTED', 'status after q');
  });

  /* ---- running, stepping, breakpoints ------------------------------------ */
  await check('literals, labels and indirect operands', async () => {
    same(await runToEnd([
      'MOV R1, 0b1010', 'ADD R1, 0x10', 'ADD R1, -3', 'OUT R1',
      'MOV R2, 0x20', 'STORE R2, 99', 'MOV R3, [R2]', 'OUT R3', 'MOV R4, [0x20]', 'OUT R4',
      'MOV R1, target', 'OUT R1', 'HLT', 'target:',
    ].join('\n')), ['23', '99', '99', '13'], 'output');
  });
  await check('Step runs one instruction at a time, F10 too', async () => {
    load('MOV R1, 7\nMOV R2, 9\nHLT');
    byId('btnStep').click();
    same([regValue('R1'), regValue('R2'), regValue('PC')], ['7', '0', '1'], 'R1, R2, PC after one step');
    same(status(), 'PAUSED · STEPPING', 'status');
    press(document.body, 'F10');
    same(regValue('R2'), '9', 'R2 after F10');
    press(document.body, 'F10');
    same(status(), 'HALTED', 'status after the HLT step');
  });
  await check('a breakpoint pauses, Resume continues, Clear breaks removes it', async () => {
    load('MOV R1, 0\nloop:\nINC R1\nCMP R1, 100\nJNE loop\nHLT');
    const row = await until(() => $('#asmGutter .ln[data-line="2"]'));
    expect(row, 'no line number for line 3');
    row.click();
    byId('btnRun').click();
    same(status(), 'PAUSED · BREAKPOINT', 'status at the breakpoint');
    same(byId('btnRunLabel').textContent, 'Resume', 'Run button label');
    same(regValue('R1'), '0', 'R1 at the first stop');
    byId('btnRun').click();
    await until(() => status() === 'PAUSED · BREAKPOINT');
    same(regValue('R1'), '1', 'R1 at the second stop');
    expect(!byId('btnClearBreaks').disabled, 'Clear breaks is disabled while a breakpoint is set');
    byId('btnClearBreaks').click();
    expect(byId('btnClearBreaks').disabled, 'Clear breaks stays enabled with no breakpoints');
    byId('btnRun').click();
    await until(() => status() === 'HALTED');
    same(regValue('R1'), '100', 'R1 at the end');
  });
  await check('a clocked run pauses with Pause and Esc, resumes, and resets with Shift+F5', async () => {
    load('loop:\nINC R1\nJMP loop', 20);
    byId('btnRun').click();
    same(status(), 'RUNNING', 'status');
    await sleep(160);
    byId('btnPause').click();
    same(status(), 'PAUSED', 'status after Pause');
    const c = parseInt(byId('cycleCount').textContent, 10);
    expect(c > 2, `only ${c} cycles in 160 ms at 20 ms`);
    byId('btnRun').click();
    same(status(), 'RUNNING', 'status after Resume');
    await sleep(60);
    press(document.body, 'Escape');
    same(status(), 'PAUSED', 'status after Esc');
    press(document.body, 'F5', { shiftKey: true });
    same([status(), byId('cycleCount').textContent, regValue('R1')], ['READY', '0', '0'], 'status, cycles and R1 after Shift+F5');
  });
  await check('IN takes numbers, hex, binary and characters, and rejects anything else', async () => {
    load('IN R1\nOUT R1\nIN R2\nOUT R2\nIN R3\nOUT R3\nHLT');
    byId('btnRun').click();
    await until(() => status() === 'AWAITING INPUT');
    same(byId('ttyMode').textContent, 'INPUT', 'TTY mode');
    await type('zz');
    expect(tty().includes('enter a number'), 'no hint after bad input');
    same(status(), 'AWAITING INPUT', 'status after bad input');
    await type('0x2A');
    await type('0b101');
    await type("'A'");
    await until(() => status() === 'HALTED');
    same(outputs(), ['42', '5', '65'], 'output');
  });
  await check('flags follow results and toggle on click', async () => {
    await runToEnd('MOV R1, 3\nSUB R1, 5\nHLT');
    const zf = $('#flags [data-flag="ZF"]'), sf = $('#flags [data-flag="SF"]');
    same([zf.textContent, sf.textContent], ['ZF 0', 'SF 1'], 'flags after 3 − 5');
    zf.click();
    same([zf.textContent, zf.getAttribute('aria-pressed')], ['ZF 1', 'true'], 'ZF after a click');
  });
  await check('runaway programs stop with a clear status', async () => {
    await runToEnd('loop:\nPUSH 1\nJMP loop');
    same(status(), 'CRASHED', 'status after an endless PUSH');
    expect(tty().includes('Stack overflow'), 'no stack overflow message');
    await runToEnd('MOV R1, 1');
    same(status(), 'HALTED · PC OUT OF RANGE', 'status after running off the end');
  });
  await check('the ÷0 guard halts on division by zero; off, it yields 0', async () => {
    await runToEnd('MOV R1, 10\nDIV R1, 0\nOUT R1\nHLT');
    same(status(), 'CRASHED', 'status with the guard on');
    expect(tty().includes('Division by zero'), 'no division message');
    ctrl('divZero').click();
    same(await runToEnd('MOV R1, 10\nDIV R1, 0\nOUT R1\nHLT'), ['0'], 'output with the guard off');
    ctrl('divZero').click();
  });

  /* ---- editing the machine ----------------------------------------------- */
  await check('a register can be edited by clicking it', async () => {
    load('HLT');
    reg('R2').click();
    const input = $('.reg-edit', reg('R2'));
    expect(input, 'no edit field');
    input.value = '0x10';
    press(input, 'Enter');
    same(regValue('R2'), '16', 'R2');
  });
  await check('memory can be read and edited from the keyboard', async () => {
    load('HLT');
    const canvas = byId('memCanvas');
    canvas.focus();
    press(canvas, 'ArrowRight'); press(canvas, 'ArrowRight'); press(canvas, 'ArrowRight');
    same(byId('memLive').textContent, 'Address 0x003, value 0', 'announcement');
    press(canvas, 'Enter');
    const input = $('#memScroll .mem-edit');
    expect(input, 'no edit field');
    input.value = '77';
    press(input, 'Enter');
    press(canvas, 'ArrowLeft'); press(canvas, 'ArrowRight');
    same(byId('memLive').textContent, 'Address 0x003, value 77', 'announcement after the edit');
    press(canvas, 'ArrowDown');
    same(byId('memLive').textContent, 'Address 0x023, value 0', 'one row down');
    expect((await hostScript('PEEK 3')).includes('[3] → 77'), 'PEEK does not see the edit');
    editorTab('asm');
  });
  await check('memory cells explain themselves on hover', async () => {
    load('HLT');
    const canvas = byId('memCanvas');
    /* A synthetic event has no offsetX/offsetY of its own in WebKit, so it gets
       the first cell's. It repeats like a moving mouse: a late scroll event from
       the previous check cancels a hover, as a real scroll does. */
    const hover = () => {
      const ev = new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse' });
      Object.defineProperties(ev, { offsetX: { value: 40 }, offsetY: { value: 24 } });
      canvas.dispatchEvent(ev);
    };
    let t = 0;
    await until(() => { if (t++ % 6 === 0) hover(); return !byId('tip').hidden; }, 2500);
    expect(/^addr 0 · 0x000 · 0/.test(byId('tip').textContent), `tip reads "${byId('tip').textContent}"`);
    canvas.dispatchEvent(new PointerEvent('pointerleave', { bubbles: false, pointerType: 'mouse' }));
  });
  await check('the DEC/HEX chip switches the display base', async () => {
    await runToEnd('MOV R1, 255\nHLT');
    byId('baseToggle').click();
    same([byId('baseToggle').textContent, regValue('R1')], ['HEX', 'FF'], 'chip and R1 in hex');
    byId('baseToggle').click();
    same([byId('baseToggle').textContent, regValue('R1')], ['DEC', '255'], 'chip and R1 in decimal');
  });

  /* ---- the CPU tab ------------------------------------------------------- */
  const opCard = name => $$('#cpuOps .op-card').find(c => $('.op-name', c).textContent === name);
  await check('the CPU tab shows the instruction being executed', async () => {
    load('MOV R1, 5\nADD R1, 2\nHLT');
    machineTab('cpu');
    byId('btnStep').click();
    same(byId('nowName').textContent, 'ADD R1, 2', 'now executing');
    expect(byId('nowArgs').textContent.includes('R1 → 5'), 'operand values missing');
    expect(byId('nowCode').textContent.startsWith('function ADD(dst, src)'), 'source missing');
    same(byId('nowOp').textContent, 'ADD R1, 2', 'header readout');
  });
  await check('an instruction can be patched live and reset', async () => {
    machineTab('cpu');
    const card = await until(() => opCard('INC'));
    card.click();
    const ta = $('.op-textarea', card);
    expect(card.classList.contains('expanded') && ta, 'the INC card did not open');
    load('MOV R1, 1\nHLT');
    ta.value = 'function INC(dst) {\n  const r = read(dst) + 2;\n  write(dst, r);\n  setFlags(r);\n}';
    fire(ta, 'input');
    press(ta, 'Enter', { ctrlKey: true });
    same($('.op-status', card).textContent, 'patched — live now', 'status after ⌘↩');
    same(status(), 'READY', 'the program after ⌘↩ in the patch editor (it must not run)');
    const prog = 'MOV R1, 1\nOUT R1\nINC R1\nOUT R1\nINC R1\nOUT R1\nHLT';
    same(await runToEnd(prog), ['1', '3', '5'], 'output with INC adding 2');
    $$('button', card).find(b => b.textContent === 'Reset').click();
    same(await runToEnd(prog), ['1', '2', '3'], 'output after Reset');
  });
  await check('a patch that does not compile is refused', async () => {
    machineTab('cpu');
    const card = opCard('INC');
    if (!card.classList.contains('expanded')) card.click();
    const ta = $('.op-textarea', card);
    ta.value = 'function INC(dst) {';
    fire(ta, 'input');
    $$('button', card).find(b => b.textContent === 'Apply').click();
    expect($('.op-status', card).classList.contains('err'), 'no error shown');
    same(await runToEnd('MOV R1, 1\nINC R1\nOUT R1\nHLT'), ['2'], 'INC still works');
    $$('button', card).find(b => b.textContent === 'Close').click();
    machineTab('memory');
  });

  /* ---- editor ------------------------------------------------------------ */
  await check('syntax is highlighted', async () => {
    load('MOV R1, 42 ; note\nloop: JMP loop\nFROB R1');
    const hl = $('#asmWrap .hl');
    const text = cls => $$('.' + cls, hl).map(s => s.textContent);
    expect(text('t-o').includes('MOV') && text('t-o').includes('JMP'), 'instructions');
    expect(text('t-r').includes('R1'), 'registers');
    expect(text('t-n').includes('42'), 'numbers');
    expect(text('t-l').includes('loop:'), 'labels');
    expect(text('t-c').includes('; note'), 'comments');
    expect(text('t-e').includes('FROB'), 'unknown instructions');
  });
  await check('syntax errors are listed as you type, and strict run refuses them', async () => {
    load('MOVE R1, 2\nADD R1\nHLT');
    await until(() => !byId('lintBar').hidden, 2000);
    expect(!byId('lintBar').hidden, 'no error bar');
    expect(byId('lintBarText').textContent.startsWith('2 syntax errors — line 1'), `error bar reads "${byId('lintBarText').textContent}"`);
    ctrl('strict').click();
    byId('btnRun').click();
    same(status(), 'SYNTAX', 'status with strict run');
    ctrl('strict').click();
    load('HLT');
    await until(() => byId('lintBar').hidden, 2000);
    expect(byId('lintBar').hidden, 'the error bar stays after the fix');
  });
  await check('the example menu reads "your program" once you edit', async () => {
    setField(byId('exampleSelect'), 'multiply');
    await until(() => byId('exampleSelect').value === 'multiply');
    const ed = byId('asmEditor');
    ed.value += '\n; mine now';
    fire(ed, 'input');
    await until(() => byId('exampleSelect').value === '', 1500);
    same(byId('exampleSelect').value, '', 'example menu');
  });
  await check('the program is saved as you type', async () => {
    load('MOV R1, 1\n; saved?');
    await until(() => localStorage.getItem('mica:program') === byId('asmEditor').value, 2500);
    same(localStorage.getItem('mica:program'), byId('asmEditor').value, 'stored program');
  });
  await check('System commands in the assembly offer the Hybrid tab', async () => {
    load('PRINT hello\nMOV R1, 1');
    await until(() => !byId('asmForeign').hidden, 2000);
    expect(!byId('asmForeign').hidden, 'no notice');
    byId('asmForeign').click();
    expect(!byId('hybridModal').hidden, 'no dialog');
    press(document.body, 'Escape');
    await until(() => byId('hybridModal').hidden, 1500);
    expect(byId('hybridModal').hidden, 'Esc did not close the dialog');
  });

  /* ---- System and Hybrid ------------------------------------------------- */
  await check('a System script drives the machine', async () => {
    load('HLT');
    const log = await hostScript('SET R1 42\nMEM 0x10 99\nPEEK 0x10\nFILL 0x20 0x23 7\nDUMP 0x20 4\nJS 6 * 7');
    expect(log.includes('R1 = 42'), 'SET');
    expect(log.includes('[16] → 99'), 'MEM and PEEK');
    expect(log.includes('0x020  07 07 07 07'), 'FILL and DUMP');
    expect(log.includes('js → 42'), 'JS');
    same(regValue('R1'), '42', 'R1 on the register card');
  });
  await check('HELP lists every command, and unknown ones are reported', async () => {
    const help = await hostScript('HELP');
    for (const c of ['PRINT', 'SET', 'RUN', 'CLOCK', 'THEME', 'BACKDROP', 'PIN', 'FLOAT', 'JS', 'HELP']) expect(help.includes(c), `HELP misses ${c}`);
    expect((await hostScript('FROB 1')).includes('unknown command "FROB"'), 'no error for FROB');
  });
  await check('the Hybrid script runs assembly and host lines on one machine', async () => {
    load('HLT');
    editorTab('hybrid');
    setField(byId('hybridPaceNum'), 0);
    setField(byId('clockHybridNum'), 0);
    byId('hybridOutput').textContent = '';
    byId('btnHybridRun').click();
    await until(() => byId('hybridOutput').textContent.includes('── done ──'), 8000);
    const log = byId('hybridOutput').textContent;
    expect(log.includes('── done ──'), 'the script did not finish');
    expect(log.includes('js → 42'), 'the host did not read R1 = 42 back');
    expect(outputs().includes('42'), 'the CPU did not print 42');
    editorTab('asm');
  });

  /* ---- library ----------------------------------------------------------- */
  await check('a script saves to the library and loads back', async () => {
    load('MOV R1, 123\nHLT');
    byId('btnSaveAsm').click();
    expect(!byId('scriptModal').hidden, 'no library dialog');
    setField(byId('scriptNameInput'), 'suite sample');
    byId('scriptModalOk').click();
    await until(() => byId('scriptModal').hidden, 1500);
    const sel = byId('savedSelAsm');
    expect([...sel.options].some(o => o.value === 'suite sample'), 'not in the Saved menu');
    load('NOP');
    setField(sel, 'suite sample');
    same(byId('asmEditor').value, 'MOV R1, 123\nHLT', 'editor after loading');
  });

  /* ---- interface --------------------------------------------------------- */
  await check('the theme switches and is remembered', async () => {
    const before = document.documentElement.dataset.theme;
    const after = before === 'dark' ? 'light' : 'dark';
    byId('themeQuick').click();
    await until(() => document.documentElement.dataset.theme === after, 1500);
    same(document.documentElement.dataset.theme, after, 'theme');
    same(localStorage.getItem('mica:theme'), after, 'stored theme');
    byId('themeQuick').click();
    await until(() => document.documentElement.dataset.theme === before, 1500);
    await sleep(300);
  });
  await check('settings open, close with Esc and give focus back', async () => {
    byId('settingsToggle').focus();
    byId('settingsToggle').click();
    expect(!byId('settingsDrawer').hidden, 'the drawer did not open');
    same(byId('settingsToggle').getAttribute('aria-expanded'), 'true', 'aria-expanded');
    press(document.body, 'Escape');
    await until(() => byId('settingsDrawer').hidden, 1500);
    expect(byId('settingsDrawer').hidden, 'Esc did not close the drawer');
    same(document.activeElement, byId('settingsToggle'), 'focus');
  });
  await check('a pinned setting appears in the footer', async () => {
    await openDrawer(true);
    const pin = $('#settingsBody .pin[data-pin="base"]');
    pin.click();
    same(pin.getAttribute('aria-pressed'), 'true', 'pin state');
    expect($('#footPins [data-ctrl="base"]'), 'no footer control');
    pin.click();
    expect(!$('#footPins [data-ctrl="base"]'), 'the footer control stays after unpinning');
    expect(!byId('clockCtrl').hidden, 'the clock is not pinned by default');
    await openDrawer(false);
  });
  await check('Motion cycles auto → reduce → full → auto', async () => {
    const m = () => document.documentElement.dataset.motion || 'auto';
    ctrl('motion').click(); same(m(), 'reduce', 'after one click');
    ctrl('motion').click(); same(m(), 'full', 'after two');
    ctrl('motion').click(); same(m(), 'auto', 'after three');
  });
  await check('Reset settings asks once, then restores the defaults', async () => {
    byId('baseToggle').click();
    same(byId('baseToggle').textContent, 'HEX', 'base before');
    ctrl('reset').click();
    same(byId('baseToggle').textContent, 'HEX', 'one click changed nothing');
    ctrl('reset').click();
    same(byId('baseToggle').textContent, 'DEC', 'base after');
  });
  await check('the manual filters as you type; Esc clears; / jumps there', async () => {
    const search = byId('refSearch');
    setField(search, 'stack');
    const shown = () => $$('#refScroll .ref-op:not(.hidden) .ref-name').map(n => n.textContent);
    expect(shown().includes('PUSH') && shown().includes('POP') && !shown().includes('ADD'), `shown: ${shown().join(' ')}`);
    setField(search, 'zzzz');
    expect(!$('#refScroll .ref-empty').hidden, 'no empty message');
    press(search, 'Escape');
    same(search.value, '', 'search after Esc');
    expect(shown().length >= 37, 'not everything is back');
    search.blur();
    press(document.body, '/');
    same(document.activeElement, search, 'focus after /');
    search.blur();
  });
  await check('the clock slider is logarithmic', async () => {
    editorTab('asm');
    const range = byId('clockAsmRange'), num = byId('clockAsmNum');
    setField(range, 0); same(num.value, '0', 'slider at 0');
    setField(range, 1000); same(num.value, '2000', 'slider at the end');
    setField(num, 100);
    expect(Math.abs(range.value - 606) <= 2, `100 ms puts the slider at ${range.value}`);
    setField(num, 0);
  });
  await check('⌘↩ / Ctrl+↩ runs the program', async () => {
    load('MOV R1, 5\nOUT R1\nHLT');
    press(document.body, 'Enter', { ctrlKey: true });
    await until(() => status() === 'HALTED');
    same(outputs(), ['5'], 'output');
  });
  await check('the divider resizes the editor from the keyboard', async () => {
    const editor = $('.editor-panel');
    const w = editor.getBoundingClientRect().width;
    const div = byId('dividerV');
    div.focus();
    press(div, 'ArrowRight');
    await sleep(50);
    const w2 = editor.getBoundingClientRect().width;
    expect(w2 > w, `width ${w} → ${w2}`);
    div.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    div.blur();
  });
  await check('the manual collapses and expands', async () => {
    const b = byId('manualCollapse');
    b.click();
    expect(document.body.classList.contains('manual-collapsed'), 'not collapsed');
    same(b.getAttribute('aria-expanded'), 'false', 'aria-expanded');
    b.click();
    expect(!document.body.classList.contains('manual-collapsed'), 'not expanded');
  });
  await check('hover info appears on controls', async () => {
    const b = byId('btnStep');
    b.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
    await until(() => !byId('tip').hidden, 1500);
    same(byId('tip').textContent, 'Execute one instruction (F10)', 'tip');
    b.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse' }));
  });
  await check('no errors on the page', async () => {
    const errs = window.__pageErrors || [];
    expect(!errs.length, errs.join(' | '));
  });

  const failed = results.filter(r => !r.ok).length;
  return { passed: results.length - failed, failed, results, agent: navigator.userAgent };
}
