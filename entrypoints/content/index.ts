import { mountContentScope } from './scope';
import 'sonner/dist/styles.css';
import './style.css';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  cssInjectionMode: 'ui',
  async main(ctx) {
    await mountContentScope(ctx);
  },
});
