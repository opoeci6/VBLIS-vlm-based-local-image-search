import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ModelLoadErrorBanner } from './ModelLoadErrorBanner';

const makeProps = (overrides = {}) => ({
  modelLoadError: { model: 'org/model-x', message: 'CUDA out of memory' },
  setModelLoadError: vi.fn(),
  status: { is_downloading: false },
  pendingModel: 'org/pending-model',
  setPendingModel: vi.fn(),
  handleDownloadModel: vi.fn(),
  ...overrides,
});

describe('ModelLoadErrorBanner', () => {
  afterEach(cleanup);

  it('is hidden without an error', () => {
    const { container } = render(<ModelLoadErrorBanner {...makeProps({ modelLoadError: null })} />);
    expect(container.firstChild).toBeNull();
  });

  it('is hidden while a download is running', () => {
    const { container } = render(<ModelLoadErrorBanner {...makeProps({ status: { is_downloading: true } })} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the model name and message', () => {
    render(<ModelLoadErrorBanner {...makeProps()} />);
    expect(screen.getByText(/Model Failed to Load: model-x/)).toBeTruthy();
    expect(screen.getByText('CUDA out of memory')).toBeTruthy();
  });

  it('falls back to "Vision Model" when the error has no model', () => {
    render(<ModelLoadErrorBanner {...makeProps({ modelLoadError: { message: 'boom' } })} />);
    expect(screen.getByText(/Model Failed to Load: Vision Model/)).toBeTruthy();
  });

  it('retries the failing model', () => {
    const props = makeProps();
    render(<ModelLoadErrorBanner {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /Retry \/ Resume/ }));
    expect(props.setModelLoadError).toHaveBeenCalledWith(null);
    expect(props.setPendingModel).toHaveBeenCalledWith('org/model-x');
    expect(props.handleDownloadModel).toHaveBeenCalledWith('org/model-x');
  });

  it('retries the pending model when the error names no model', () => {
    const props = makeProps({ modelLoadError: { message: 'boom' } });
    render(<ModelLoadErrorBanner {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /Retry \/ Resume/ }));
    expect(props.setPendingModel).toHaveBeenCalledWith('org/pending-model');
    expect(props.handleDownloadModel).toHaveBeenCalledWith('org/pending-model');
  });

  it('dismisses the error', () => {
    const props = makeProps();
    render(<ModelLoadErrorBanner {...props} />);
    fireEvent.click(screen.getByTitle('Dismiss error'));
    expect(props.setModelLoadError).toHaveBeenCalledWith(null);
    expect(props.handleDownloadModel).not.toHaveBeenCalled();
  });
});
