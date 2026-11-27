import { describe, expect, it, vi } from 'vitest';

import { buildCatalogIndex } from '../catalog/catalog-index';
import { storeFixture } from '../test/fixtures';
import { MANAGER } from '../test/shop';
import { createCartStore } from './cart-store';
import { requestApproval } from './register-actions';
import { createRegisterStore } from './register-store';

function setUp() {
  const deps = {
    cart: createCartStore(),
    register: createRegisterStore(),
    catalog: buildCatalogIndex([], []),
    store: storeFixture,
    beep: vi.fn(),
  };
  const run = vi.fn();
  requestApproval(deps, 'Because', run);
  const dialog = deps.register.getState().dialog;
  if (dialog?.type !== 'approval') throw new Error('no approval dialog');
  return { ...deps, run, dialog };
}

describe('requestApproval', () => {
  it('runs the change and closes the dialog once approved', () => {
    const { register, run, dialog } = setUp();

    dialog.onApproved(MANAGER);

    expect(run).toHaveBeenCalledTimes(1);
    expect(register.getState().dialog).toBeNull();
  });

  it('runs it only once', () => {
    const { run, dialog } = setUp();

    dialog.onApproved(MANAGER);
    dialog.onApproved(MANAGER);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('ignores a PIN that passes after the cashier cancelled', () => {
    const { register, run, dialog } = setUp();

    register.getState().closeDialog();
    dialog.onApproved(MANAGER);

    expect(run).not.toHaveBeenCalled();
  });
});
