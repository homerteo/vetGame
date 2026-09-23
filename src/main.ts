import './ui/theme.css';
import { createGameFlow } from './game/GameFlow';

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui-root') as HTMLElement;
createGameFlow(canvas, uiRoot).start();
