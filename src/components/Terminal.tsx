import { onCleanup, onMount } from 'solid-js';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

interface TerminalComponentProps {
  onReady: (term: Terminal) => void | Promise<void>;
}

const TerminalComponent = (props: TerminalComponentProps) => {
  let terminalRef: HTMLDivElement | undefined;

  onMount(() => {
    if (!terminalRef) return;

    const term = new Terminal({
      convertEol: true,
      fontFamily: `'Fira Code', Menlo, Monaco, 'Courier New', monospace`,
      fontSize: 14,
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
      },
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    term.open(terminalRef);
    fitAddon.fit();

    props.onReady(term);

    const handleResize = () => {
      fitAddon.fit();
    };

    window.addEventListener('resize', handleResize);

    onCleanup(() => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
    });
  });

  return <div ref={terminalRef} style={{ width: '100%', height: '100%' }} />;
};

export default TerminalComponent;
