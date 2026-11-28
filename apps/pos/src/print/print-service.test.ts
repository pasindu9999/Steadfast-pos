// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPrinter } from './print-service';

afterEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

/** 96 CSS pixels to the inch. */
const px = (mm: number) => (mm * 96) / 25.4;

function showReceipt(heightMm: number): void {
  const receipt = document.createElement('article');
  receipt.setAttribute('data-print-receipt', '');
  vi.spyOn(receipt, 'getBoundingClientRect').mockReturnValue({
    height: px(heightMm),
  } as DOMRect);
  document.body.append(receipt);
}

function setUp() {
  const print = vi.fn();
  const target = Object.assign(new EventTarget(), { print, document });
  const printer = createPrinter(() => target);
  const done = vi.fn();
  const stop = printer.watch(done);
  const fire = (type: 'beforeprint' | 'afterprint') => target.dispatchEvent(new Event(type));
  return { printer, print, done, stop, fire, target };
}

/** The injected `@page` rules. */
const pageRules = () =>
  [...document.querySelectorAll('style[data-print-page]')].map((style) => style.textContent);

describe('printing', () => {
  it('asks the browser to print, once per call', () => {
    const { printer, print } = setUp();

    printer.print();
    printer.print();

    expect(print).toHaveBeenCalledTimes(2);
  });

  it('says when the print dialog is done', () => {
    const { printer, done, fire } = setUp();

    printer.print();
    expect(done).not.toHaveBeenCalled();
    fire('afterprint');

    expect(done).toHaveBeenCalledTimes(1);
  });

  it('stops saying so once no longer watched', () => {
    showReceipt(200);
    const { done, stop, fire } = setUp();

    stop();
    fire('beforeprint');
    fire('afterprint');

    expect(done).not.toHaveBeenCalled();
    expect(pageRules()).toEqual([]);
  });

  it('never throws, and logs only the kind of failure', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { printer, print } = setUp();
    print.mockImplementation(() => {
      throw new DOMException('secret detail', 'NotAllowedError');
    });

    expect(() => printer.print()).not.toThrow();
    expect(warn).toHaveBeenCalledWith('printing failed', 'NotAllowedError');
  });

  it('can print again when the browser never says it finished', () => {
    const { printer, print } = setUp();

    printer.print();
    printer.print();

    expect(print).toHaveBeenCalledTimes(2);
  });
});

describe('page size', () => {
  it('is 80 mm wide and as long as the receipt when printing starts', () => {
    showReceipt(199.8);
    const { printer, print } = setUp();
    let rules: (string | null)[] = [];
    print.mockImplementation(() => {
      rules = pageRules();
    });

    printer.print();

    // Rounded up, with a millimetre to spare so that nothing spills onto a second page.
    expect(rules).toEqual(['@page { size: 80mm 201mm; margin: 0; }']);
  });

  it('is also set when printing from the browser menu', () => {
    showReceipt(150);
    const { fire } = setUp();

    fire('beforeprint');

    expect(pageRules()).toEqual(['@page { size: 80mm 151mm; margin: 0; }']);
  });

  it('is never shorter than it is wide, which would turn the page', () => {
    showReceipt(30);
    const { printer } = setUp();

    printer.print();

    expect(pageRules()).toEqual(['@page { size: 80mm 80mm; margin: 0; }']);
  });

  it('is set once however many times it is asked', () => {
    showReceipt(150);
    const { printer, fire } = setUp();
    printer.watch(() => undefined);

    printer.print();
    fire('beforeprint');
    printer.print();

    expect(pageRules()).toHaveLength(1);
  });

  it('is removed after printing', () => {
    showReceipt(150);
    const { printer, fire } = setUp();

    printer.print();
    fire('afterprint');

    expect(pageRules()).toEqual([]);
  });

  it('is left alone on a screen without a receipt', () => {
    const { printer } = setUp();

    printer.print();

    expect(pageRules()).toEqual([]);
  });
});

describe('a print waiting for its receipt', () => {
  it('is taken once', () => {
    const { printer } = setUp();

    printer.request('sale-1');

    expect(printer.take('sale-1')).toBe(true);
    expect(printer.take('sale-1')).toBe(false);
  });

  it('is only for the receipt that was asked for', () => {
    const { printer } = setUp();

    printer.request('sale-1');

    expect(printer.take('sale-2')).toBe(false);
    expect(printer.take('sale-1')).toBe(true);
  });

  it('is replaced by a newer one', () => {
    const { printer } = setUp();

    printer.request('sale-1');
    printer.request('sale-2');

    expect(printer.take('sale-1')).toBe(false);
    expect(printer.take('sale-2')).toBe(true);
  });

  it('is dropped on leaving for another screen', () => {
    const { printer } = setUp();

    printer.request('sale-1');
    printer.keepOnly(null);

    expect(printer.take('sale-1')).toBe(false);
  });

  it('is kept on arriving at its receipt', () => {
    const { printer } = setUp();

    printer.request('sale-1');
    printer.keepOnly('sale-1');

    expect(printer.take('sale-1')).toBe(true);
  });
});
