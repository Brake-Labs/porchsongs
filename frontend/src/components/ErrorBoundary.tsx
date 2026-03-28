import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

interface Props {
  children: ReactNode;
  /** Label shown in the error message to identify the crashed area. */
  fallbackLabel?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const { fallbackLabel } = this.props;
      return (
        <div className="flex items-center justify-center p-8">
          <Card className="p-8 sm:p-10 w-full max-w-md mx-4 text-center flex flex-col items-center gap-4 shadow-md">
            <h1 className="font-display text-2xl font-bold text-foreground">Something went wrong</h1>
            <p className="text-sm text-muted-foreground">
              {fallbackLabel
                ? `An error occurred in ${fallbackLabel}. You can try again or reload the page.`
                : 'An unexpected error occurred. Please try reloading the page.'}
            </p>
            <div className="flex gap-2">
              <Button onClick={this.handleReset}>Try Again</Button>
              <Button variant="secondary" onClick={() => window.location.reload()}>
                Reload Page
              </Button>
            </div>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
