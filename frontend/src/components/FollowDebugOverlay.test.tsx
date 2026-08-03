import { render, screen } from '@testing-library/react';
import FollowDebugOverlay from './FollowDebugOverlay';

describe('FollowDebugOverlay', () => {
  it('renders status, top candidate text, and recently heard words', () => {
    render(
      <FollowDebugOverlay
        estimate={{
          status: 'locked',
          renderIndex: 2,
          stateIndex: 0,
          confidence: 0.82,
          ambiguous: false,
          support: 0.7,
          top: [{ stateIndex: 0, renderIndex: 2, p: 0.82 }],
        }}
        lyricStates={[{ renderIndex: 2, tokens: ['hold', 'me', 'now'] }]}
        recentWords={['walking', 'down', 'the']}
        running
        recording={false}
        error={null}
      />,
    );
    expect(screen.getByText('locked')).toBeInTheDocument();
    expect(screen.getByText('conf 0.82')).toBeInTheDocument();
    expect(screen.getByText('hold me now')).toBeInTheDocument();
    expect(screen.getByText('walking down the')).toBeInTheDocument();
    expect(screen.getByText('live')).toBeInTheDocument();
  });

  it('surfaces a signal error', () => {
    render(
      <FollowDebugOverlay
        estimate={null}
        lyricStates={[]}
        recentWords={[]}
        running={false}
        recording={false}
        error={{ type: 'permission-denied' }}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('permission-denied');
  });
});
