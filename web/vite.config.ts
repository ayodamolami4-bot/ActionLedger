import {defineConfig} from 'vite';
export default defineConfig({server:{port:5173,proxy:{'/actions':'http://127.0.0.1:4400','/metrics':'http://127.0.0.1:4400','/worker':'http://127.0.0.1:4400','/health':'http://127.0.0.1:4400'}}});
