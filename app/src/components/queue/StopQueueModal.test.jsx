import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StopQueueModal } from './StopQueueModal';

const renderModal = (overrides = {}) => {
  const props = { isOpen: true, onClose: vi.fn(), onSelectOption: vi.fn(), uiTheme: 'modern', ...overrides };
  return { props, ...render(<StopQueueModal {...props} />) };
};

describe('StopQueueModal', () => {
  afterEach(cleanup);

  it('renders nothing when closed', () => {
    const { container } = renderModal({ isOpen: false });
    expect(container.firstChild).toBeNull();
  });

  it.each(['modern', 'terminal'])('reports the chosen option in the %s theme', (uiTheme) => {
    const { props } = renderModal({ uiTheme });
    fireEvent.click(screen.getByText('Stop Immediately'));
    expect(props.onSelectOption).toHaveBeenCalledWith('pause_immediate');
    fireEvent.click(screen.getByText('Finish Current Task then Stop'));
    expect(props.onSelectOption).toHaveBeenCalledWith('pause_after_current');
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('closes on a backdrop click and with Cancel', () => {
    const { props, container } = renderModal();
    fireEvent.click(container.firstChild);
    expect(props.onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Cancel'));
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it('does not close on a click inside the dialog', () => {
    const { props } = renderModal();
    fireEvent.click(screen.getByText('Stop Background Queue'));
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('stays open when a drag from inside the dialog ends on the backdrop', () => {
    const { props, container } = renderModal();
    fireEvent.mouseDown(screen.getByText(/An indexing or rebuild task/));
    fireEvent.click(container.firstChild);
    expect(props.onClose).not.toHaveBeenCalled();
  });
});
