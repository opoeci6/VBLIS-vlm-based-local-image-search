import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ModelDownloadBanner } from './ModelDownloadBanner';

const makeStatus = (overrides = {}) => ({
  is_downloading: true,
  is_loading_model: false,
  cancel_download: false,
  download_total_bytes: 1000,
  download_current_bytes: 250,
  download_speed: 100,
  download_eta: 9,
  ...overrides,
});

const renderBanner = (statusOverrides, handleCancelDownload = vi.fn()) => {
  render(
    <ModelDownloadBanner
      status={makeStatus(statusOverrides)}
      pendingModel="org/model-x"
      handleCancelDownload={handleCancelDownload}
    />
  );
  return handleCancelDownload;
};

describe('ModelDownloadBanner', () => {
  afterEach(cleanup);

  it('is hidden when not downloading', () => {
    const { container } = render(
      <ModelDownloadBanner status={makeStatus({ is_downloading: false })} pendingModel="org/model-x" handleCancelDownload={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows the model name, percentage, size, speed and ETA', () => {
    renderBanner();
    expect(screen.getByText('Downloading AI Vision Engine: model-x')).toBeTruthy();
    expect(screen.getByText('25%')).toBeTruthy();
    expect(screen.getByText(/Size: 250 B \/ 1000 B/)).toBeTruthy();
    expect(screen.getByText(/Speed: 100 B\/s/)).toBeTruthy();
    expect(screen.getByText(/ETA: 9s/)).toBeTruthy();
  });

  it('shows "Starting..." before the size is known', () => {
    renderBanner({ download_total_bytes: 0, download_current_bytes: 0 });
    expect(screen.getByText('Starting...')).toBeTruthy();
  });

  it('shows the verifying message once all bytes arrived', () => {
    renderBanner({ download_current_bytes: 1000 });
    expect(screen.getByText('Verifying & Finalizing download...')).toBeTruthy();
    expect(screen.getByText('100%')).toBeTruthy();
    expect(screen.queryByText(/Speed:/)).toBeNull();
  });

  it('shows the finalizing state while the model loads', () => {
    renderBanner({ is_loading_model: true });
    expect(screen.getByText('Finalizing & Loading AI Vision Engine...')).toBeTruthy();
    expect(screen.getByText('99%')).toBeTruthy();
    expect(screen.getByText('Warming up tensors in memory...')).toBeTruthy();
    expect(screen.queryByText(/Size:/)).toBeNull();
  });

  it('calls handleCancelDownload on Cancel', () => {
    const handleCancelDownload = renderBanner();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(handleCancelDownload).toHaveBeenCalledTimes(1);
  });

  it('is disabled and relabelled once cancelling', () => {
    renderBanner({ cancel_download: true });
    const button = screen.getByRole('button', { name: 'Cancelling...' });
    expect(button.disabled).toBe(true);
  });
});
