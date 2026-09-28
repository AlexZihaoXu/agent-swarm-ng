import { expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { buildApp } from './app';
import { EndpointStore } from './endpoint-store';
import { prepareDatabase } from './test-database';
import { OPENROUTER_URL } from './openrouter';
it('discovers tool-capable OpenRouter models and applies provider capabilities when creating an agent without exposing its key', async () => {
  const catalog = { data: [
    { id:'test-provider/new-image-model', context_length:131072, architecture:{input_modalities:['text','image'],output_modalities:['text']}, supported_parameters:['tools','reasoning'] },
    { id:'test-provider/no-tools', context_length:8192, architecture:{input_modalities:['text'],output_modalities:['text']}, supported_parameters:[] },
  ] };
  const fetcher=vi.fn().mockResolvedValue(Response.json(catalog));
  const store=new EndpointStore(join(process.env.SQLITE_TEST_ROOT!,`${crypto.randomUUID()}.json`));
  const db=await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!,`${crypto.randomUUID()}.db`));
  const app=await buildApp({endpointStore:store,database:db,fetcher:fetcher as unknown as typeof fetch});
  try {
    const saved=await app.inject({method:'POST',url:'/api/model-endpoints',payload:{id:'router',name:'OpenRouter',baseUrl:OPENROUTER_URL,apiKey:'test-private-key'}});
    expect(saved.statusCode).toBe(200); expect(saved.body).not.toContain('test-private-key');
    const models=await app.inject({method:'POST',url:'/api/model-endpoints/test',payload:{endpointId:'router',baseUrl:OPENROUTER_URL}});
    expect(models.json()).toEqual({models:['test-provider/new-image-model']});
    expect(String(fetcher.mock.calls[0][0])).toBe(OPENROUTER_URL+'/models');
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer test-private-key');
    const capabilities=await app.inject('/api/agents/model-capabilities?endpointId=router&model=test-provider%2Fnew-image-model');
    expect(capabilities.statusCode).toBe(200); expect(capabilities.json().reasoning).toBe(true); expect(capabilities.json().thinkingLevels).toContain('low');
    const agent=await app.inject({method:'POST',url:'/api/agents',payload:{name:'Router agent',endpointId:'router',model:'test-provider/new-image-model',thinkingLevel:'low'}});
    expect(agent.statusCode).toBe(200); expect(agent.json().endpointId).toBe('router');
    expect((await app.inject('/api/model-endpoints')).body).not.toContain('test-private-key');
  } finally { await app.close(); }
});
