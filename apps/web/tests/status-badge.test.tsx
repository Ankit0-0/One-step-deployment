import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DEPLOYMENT_STATUSES } from '@osd/shared';
import { StatusBadge } from '@/components/status-badge';

describe('StatusBadge', () => {
  it.each(DEPLOYMENT_STATUSES)('renders a labelled badge for %s', (status) => {
    const { container } = render(<StatusBadge status={status} />);
    expect(container.querySelector(`[data-status="${status}"]`)).not.toBeNull();
    expect(screen.getByText(status.charAt(0) + status.slice(1).toLowerCase())).toBeInTheDocument();
  });
});
