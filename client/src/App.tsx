import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './components/layout/AppLayout';
import OverviewPage from './features/overview/OverviewPage';
import RepositoriesPage from './features/repositories/RepositoriesPage';
import RepositoryDetailPage from './features/repositories/RepositoryDetailPage';
import ScanPage from './features/pipelines/ScanPage';
import PipelineDetailPage from './features/pipelines/PipelineDetailPage';
import VulnerabilitiesPage from './features/findings/VulnerabilitiesPage';
import RemediationPage from './features/remediation/RemediationPage';
import MemoryPage from './features/memory/MemoryPage';
import SettingsPage from './features/settings/SettingsPage';
import DependencyGraphPage from './features/graph/DependencyGraphPage';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Unhandled UI Error caught by boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[50vh] p-6 text-center">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-severity-critical/15 text-severity-critical mb-4">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-ink-50">Interface Encountered an Error</h2>
          <p className="text-sm text-ink-400 mt-1 max-w-md">
            {this.state.error?.message || 'An unexpected rendering error occurred.'}
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
            className="mt-4 flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-ink-800 hover:bg-ink-700 text-ink-100 border border-ink-600/60 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Reload Interface
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<AppLayout />}>
            <Route index element={<OverviewPage />} />
            <Route path="repositories" element={<RepositoriesPage />} />
            <Route path="repositories/:id" element={<RepositoryDetailPage />} />
            <Route path="graph" element={<DependencyGraphPage />} />
            <Route path="scan" element={<ScanPage />} />
            <Route path="scan/pipeline/:id" element={<PipelineDetailPage />} />
            <Route path="pipelines/:id" element={<PipelineDetailPage />} />
            <Route path="vulnerabilities" element={<VulnerabilitiesPage />} />
            <Route path="remediation" element={<RemediationPage />} />
            <Route path="memory" element={<MemoryPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
