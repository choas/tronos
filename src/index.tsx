/* @refresh reload */
import { render } from 'solid-js/web'

import '@xterm/xterm';
import '@xterm/addon-fit';
import '@xterm/addon-web-links';
import 'idb';

import './index.css'
import './styles/main.css'
import App from './App.tsx'

const root = document.getElementById('root')

render(() => <App />, root!)
