import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { IndexDangerZone } from './IndexDangerZone';

const renderZone = (overrides = {}) => {
  const props = {
    showConfirmClear: false,
    setShowConfirmClear: vi.fn(),
    handleClearCache: vi.fn(),
    isClearing: false,
    models: { active_model: 'org/model-a' },
    ...overrides,
  };
  return { props, ...render(<IndexDangerZone {...props} />) };
};

describe('IndexDangerZone', () => {
  afterEach(cleanup);

  it('asks for confirmation first', () => {
    const { props } = renderZone();
    expect(screen.getByText(/Permanently deletes all vector embeddings/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Clear Indexed Database/ }));
    expect(props.setShowConfirmClear).toHaveBeenCalledWith(true);
    expect(props.handleClearCache).not.toHaveBeenCalled();
  });

  it('is disabled without an active model', () => {
    renderZone({ models: { active_model: '' } });
    expect(screen.getByRole('button', { name: /Clear Indexed Database/ }).disabled).toBe(true);
  });

  it('shows progress while clearing', () => {
    renderZone({ isClearing: true });
    const button = screen.getByRole('button', { name: /Clearing Database/ });
    expect(button.disabled).toBe(true);
  });

  describe('confirm mode', () => {
    it('deletes on "Yes, Delete"', () => {
      const { props } = renderZone({ showConfirmClear: true });
      expect(screen.getByText('Are you sure? This cannot be undone.')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Yes, Delete' }));
      expect(props.handleClearCache).toHaveBeenCalledTimes(1);
    });

    it('cancels', () => {
      const { props } = renderZone({ showConfirmClear: true });
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(props.setShowConfirmClear).toHaveBeenCalledWith(false);
      expect(props.handleClearCache).not.toHaveBeenCalled();
    });

    it('shows "Deleting..." and disables both buttons while clearing', () => {
      renderZone({ showConfirmClear: true, isClearing: true });
      expect(screen.getByRole('button', { name: /Deleting/ }).disabled).toBe(true);
      expect(screen.getByRole('button', { name: 'Cancel' }).disabled).toBe(true);
    });
  });
});
