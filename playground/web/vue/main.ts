import { createApp } from 'vue';
import App from './App.vue';
import '../../shared/page.css';
const app = createApp(App);
app.mount('#app');
if (import.meta.hot) import.meta.hot.dispose(() => app.unmount());
