import fs from 'fs';
import path from 'path';
import { JSDOM, VirtualConsole } from 'jsdom';

async function testBundle() {
  const htmlPath = path.join(process.cwd(), '..', 'dist', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  const virtualConsole = new VirtualConsole();
  virtualConsole.on('error', (err) => {
    console.error('[BROWSER ERROR]', err);
  });
  virtualConsole.on('warn', (warn) => {
    console.warn('[BROWSER WARN]', warn);
  });
  virtualConsole.on('log', (log) => {
    console.log('[BROWSER LOG]', log);
  });

  const dom = new JSDOM(html, {
    url: 'https://envelope-ethics-reporting-defence.trycloudflare.com/tenant',
    runScripts: 'dangerously',
    resources: 'usable',
    virtualConsole
  });

  // Provide mock fetch and window properties
  dom.window.fetch = async (input: any, init: any) => {
    console.log('[MOCK FETCH CALL]', input);
    if (String(input).includes('/api/v1/tenant-portal/profile')) {
      return {
        ok: true,
        json: async () => ({
          id: 'candidate_ag_user_9ca7452e-14bc-422d-9eff-a53f728adf58',
          tenantNumber: 'PENDING',
          displayName: 'Phoom',
          name: 'Phoom',
          status: 'unregistered',
          dormitory: { id: 'eb729e0a-4502-4df5-8e25-c60b247fc64b', name: 'หอพัก HorPlus UAT Fresh Owner' }
        })
      };
    }
    return { ok: true, json: async () => ({}) };
  };

  dom.window.matchMedia = dom.window.matchMedia || function() {
    return {
      matches: false,
      addListener: function() {},
      removeListener: function() {}
    };
  };

  console.log('Waiting for DOM content loaded and scripts...');
  await new Promise(r => setTimeout(r, 2000));

  console.log('Root innerHTML length:', dom.window.document.getElementById('root')?.innerHTML.length);
  console.log('Root innerHTML snippet:', dom.window.document.getElementById('root')?.innerHTML.slice(0, 300));
}

testBundle().catch(console.error);
