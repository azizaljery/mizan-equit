import type { Parser } from '../fallback';
import type { DataType } from '../types';
import { secDispatch } from './sec';
import { yahooDispatch } from './yahoo';
import {tadawulDispatch} from './tadawul';

export function getParser<T>(dataType:DataType):Parser<T>{
  return (raw,source,ctx)=>{
    switch(source.id){
      case 'sec':return secDispatch<T>(dataType,raw,source,ctx);
      case 'yahoo':return yahooDispatch<T>(dataType,raw,source,ctx);
      case 'tadawul':
      case 'sahmk':return tadawulDispatch<T>(dataType,raw,source,ctx);
      default:throw new Error(`لا يوجد parser للمصدر ${source.id} والنوع ${dataType}.`);
    }
  };
}
export {secDispatch} from './sec';
export {yahooDispatch} from './yahoo';
export {tadawulDispatch} from './tadawul';
