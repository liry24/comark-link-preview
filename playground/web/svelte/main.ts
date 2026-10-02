import { mount, unmount } from 'svelte';
import App from './App.svelte';
import '../../shared/page.css';
const app = mount(App, { target: document.getElementById('app')! });
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    void unmount(app);
  });
