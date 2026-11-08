import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ModelSwitchWarningModal } from './ModelSwitchWarningModal';

const renderModal = (overrides = {}) => {
  const props = {
    isOpen: true,
    mode: 'active_task',
    targetModel: 'org/model-b',
    activeTask: { title: 'Index folders', processed_count: 3, total_count: 10, progress: 30 },
    pendingCount: 2,
    onConfirmCancelAndSwitch: vi.fn(),
    onConfirmProceedWithQueued: vi.fn(),
    onConfirmClearQueueAndSwitch: vi.fn(),
    onClose: vi.fn(),
    uiTheme: 'modern',
    ...overrides,
  };
  return { props, ...render(<ModelSwitchWarningModal {...props} />) };
};

describe('ModelSwitchWarningModal', () => {
  afterEach(cleanup);

  it('renders nothing when closed', () => {
    const { container } = renderModal({ isOpen: false });
    expect(container.firstChild).toBeNull();
  });

  it.each(['active_task', 'queued_tasks'])('closes on a backdrop click in %s mode', (mode) => {
    const { props, container } = renderModal({ mode });
    fireEvent.click(container.firstChild);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it.each(['modern', 'terminal'])('does not close on a click inside the dialog (%s theme)', (uiTheme) => {
    const { props } = renderModal({ uiTheme });
    fireEvent.click(screen.getByText('Active Task In Progress'));
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('stays open when a drag from inside the dialog ends on the backdrop', () => {
    const { props, container } = renderModal();
    fireEvent.mouseDown(screen.getByText(/Cannot switch models while an indexing/));
    fireEvent.click(container.firstChild);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('runs the confirm actions without closing', () => {
    const { props } = renderModal();
    fireEvent.click(screen.getByText('Cancel Task & Switch'));
    expect(props.onConfirmCancelAndSwitch).toHaveBeenCalledTimes(1);
    expect(props.onClose).not.toHaveBeenCalled();
  });
});
