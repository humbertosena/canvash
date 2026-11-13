import { createApp } from 'vue';
import { App } from './App.js';

const el = document.getElementById('app');
if (el) {
  createApp(App).mount(el);
}
