// Contains any MapLibre/WebGL failure so a broken GPU context never takes down the rest of the
// explorer (Constitution IV graceful degradation). The fallback keeps the labelled map region in the
// layout so filters/lists/chat stay usable.

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  failed: boolean;
}

export class MapErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Swallowed by design — the map is non-critical; the rest of the app continues.
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <div className="map-canvas" aria-label="Карта на България" data-map-unavailable="true">
          <p style={{ padding: 12 }}>Картата не е налична в тази среда.</p>
        </div>
      );
    }
    return this.props.children;
  }
}
