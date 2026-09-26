import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LogViewer } from '@/components/log-viewer';
import { log } from './fixtures';

/** jsdom has no layout; give the scroll container fixed metrics we can drive. */
function mockScrollMetrics(
  el: HTMLElement,
  metrics: { scrollHeight: number; clientHeight: number },
) {
  Object.defineProperty(el, 'scrollHeight', {
    configurable: true,
    get: () => metrics.scrollHeight,
  });
  Object.defineProperty(el, 'clientHeight', {
    configurable: true,
    get: () => metrics.clientHeight,
  });
}

describe('LogViewer', () => {
  it('shows a skeleton while history loads', () => {
    render(<LogViewer logs={[]} state="loading" />);
    expect(screen.getByTestId('log-loading')).toBeInTheDocument();
    expect(screen.getByRole('log')).toHaveAttribute('aria-busy', 'true');
  });

  it('renders each line with its level and strips ANSI escapes', () => {
    render(
      <LogViewer
        state="complete"
        logs={[
          log(1, '\u001b[32m✓ built in 1.2s\u001b[39m'),
          log(2, 'npm WARN deprecated', 'warn'),
          log(3, 'Build failed', 'error'),
        ]}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.dataset.level)).toEqual(['info', 'warn', 'error']);
    expect(items[0]).toHaveTextContent('✓ built in 1.2s');
    expect(items[0]!.textContent).not.toContain('\u001b');
    expect(items[2]!.className).toContain('text-red-400');
  });

  it('distinguishes waiting for output from a finished deployment with no logs', () => {
    const { rerender } = render(<LogViewer logs={[]} state="live" />);
    expect(screen.getByText('Waiting for build output…')).toBeInTheDocument();
    rerender(<LogViewer logs={[]} state="complete" />);
    expect(screen.getByText('No logs were recorded for this deployment.')).toBeInTheDocument();
  });

  it('shows the error with a retry button', async () => {
    const onRetry = vi.fn();
    render(<LogViewer logs={[]} state="error" error={new Error('boom')} onRetry={onRetry} />);
    expect(screen.getByText('Could not load logs: boom')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('follows new lines, pauses when scrolled up, and resumes on "jump to latest"', async () => {
    const metrics = { scrollHeight: 1000, clientHeight: 300 };
    const { rerender } = render(<LogViewer logs={[log(1)]} state="live" />);
    const scroller = screen.getByTestId('log-scroll');
    mockScrollMetrics(scroller, metrics);

    // New line while following → pinned to the bottom.
    metrics.scrollHeight = 1200;
    rerender(<LogViewer logs={[log(1), log(2)]} state="live" />);
    expect(scroller.scrollTop).toBe(1200);

    // User scrolls up → following pauses.
    act(() => {
      scroller.scrollTop = 100;
      fireEvent.scroll(scroller);
    });
    metrics.scrollHeight = 1400;
    rerender(<LogViewer logs={[log(1), log(2), log(3), log(4)]} state="live" />);
    expect(scroller.scrollTop).toBe(100);
    const jump = screen.getByRole('button', { name: /2 new lines/ });

    await userEvent.click(jump);
    expect(scroller.scrollTop).toBe(1400);
    expect(
      screen.queryByRole('button', { name: /new lines|Jump to latest/ }),
    ).not.toBeInTheDocument();

    // Following again → next line scrolls too.
    metrics.scrollHeight = 1600;
    rerender(<LogViewer logs={[log(1), log(2), log(3), log(4), log(5)]} state="live" />);
    expect(scroller.scrollTop).toBe(1600);
  });

  it('resumes following when the user scrolls back to the bottom', () => {
    const metrics = { scrollHeight: 1000, clientHeight: 300 };
    render(<LogViewer logs={[log(1), log(2)]} state="live" />);
    const scroller = screen.getByTestId('log-scroll');
    mockScrollMetrics(scroller, metrics);

    act(() => {
      scroller.scrollTop = 0;
      fireEvent.scroll(scroller);
    });
    expect(screen.getByRole('button', { name: 'Jump to latest' })).toBeInTheDocument();
    act(() => {
      scroller.scrollTop = 690; // within the sticky threshold of 700
      fireEvent.scroll(scroller);
    });
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).not.toBeInTheDocument();
  });

  it('only announces lines to screen readers while live', () => {
    const { rerender } = render(<LogViewer logs={[log(1)]} state="live" />);
    expect(screen.getByRole('log')).toHaveAttribute('aria-live', 'polite');
    rerender(<LogViewer logs={[log(1)]} state="complete" />);
    expect(screen.getByRole('log')).toHaveAttribute('aria-live', 'off');
  });
});
