#!/usr/bin/env node
import {adminRequest} from './admin-http.mjs';
try{
  const data=await adminRequest('/api/admin/verify'),cron=data.checks?.cron;
  if(!cron||typeof cron.ok!=='boolean')throw Error('لا يوجد فحص Cron صالح.');
  console.log(JSON.stringify(cron,null,2));process.exitCode=cron.ok?0:3;
}catch(error){console.error(error.message);process.exitCode=2;}
