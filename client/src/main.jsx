import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-[#f7f3ef] px-4 text-gray-950">
          <section className="w-full max-w-lg rounded-2xl border border-red-100 bg-white p-6 shadow-sm">
            <p className="text-sm font-semibold uppercase text-red-600">Something broke</p>
            <h1 className="mt-2 text-xl font-semibold">The app hit a render error</h1>
            <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
              {this.state.error?.message || 'Unknown error'}
            </p>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
