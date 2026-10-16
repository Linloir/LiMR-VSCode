import { Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '@linloir/limr/styles.css';
import '@linloir/limr/math.css';
import '@fontsource-variable/noto-serif-sc';
import './styles.css';
import { App } from './App';
import { post } from './bridge';

class ReaderBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() {
    return this.state.error ? <div className="lv-loading" role="alert"><h2>暂时无法显示这份 Markdown</h2><p>{this.state.error}</p><button onClick={() => post({ type: 'openSource' })}>打开源码</button><button onClick={() => location.reload()}>重新加载阅读器</button></div> : this.props.children;
  }
}
createRoot(document.getElementById('root')!).render(<ReaderBoundary><App /></ReaderBoundary>);
