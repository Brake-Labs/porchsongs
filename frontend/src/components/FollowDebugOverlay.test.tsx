import { render, screen } from '@testing-library/react';
import FollowDebugOverlay from './FollowDebugOverlay';
import type { SignalStage } from '@/lib/followSignal';

describe('FollowDebugOverlay', () => {
  it('renders status, top candidate text, and recently heard words', () => {
    render(
      <FollowDebugOverlay
        estimate={{
          status: 'locked',
          renderIndex: 2,
          stateIndex: 0,
          confidence: 0.82,
          regionConfidence: 0.9,
          ambiguous: false,
          support: 0.7,
          origin: 'audio',
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
    expect(screen.getByText('region 0.90')).toBeInTheDocument();
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

  describe('capture ladder', () => {
    function renderStage(stage: SignalStage | null) {
      return render(
        <FollowDebugOverlay
          estimate={null}
          lyricStates={[]}
          recentWords={[]}
          running
          recording={false}
          error={null}
          stage={stage}
        />,
      );
    }

    function reached() {
      const rungs = screen.getByLabelText('Capture stage').querySelectorAll('[data-reached]');
      return [...rungs]
        .filter((el) => el.getAttribute('data-reached') === 'true')
        .map((el) => el.textContent);
    }

    it('marks every rung up to the one reported, and no further', () => {
      renderStage('sound');
      // 'sound' means audio was reached too: the milestones only ever climb.
      expect(reached()).toEqual(['audio', 'sound']);
    });

    it('shows the mic open but hearing nothing as exactly that', () => {
      renderStage('audio');
      expect(reached()).toEqual(['audio']);
    });

    it('says nothing was reported rather than showing three failures', () => {
      // WebKit fires no soundstart at all, so an unreported ladder is not a
      // fault and must not read as one.
      renderStage(null);
      expect(reached()).toEqual([]);
      expect(screen.getByText('unreported')).toBeInTheDocument();
    });

    it('drops the unreported note once anything is reported', () => {
      renderStage('speech');
      expect(reached()).toEqual(['audio', 'sound', 'speech']);
      expect(screen.queryByText('unreported')).not.toBeInTheDocument();
    });
  });
});
