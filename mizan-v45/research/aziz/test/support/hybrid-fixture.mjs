// Deterministic synthetic data for software checks, never evidence of market accuracy.
export const SMALL_POLICY={trainWindow:100,minTrain:24,minStack:12,minCalibration:10,calibrationWindow:60};
export function makeFixture(n=180,market='US'){
 const observed=(i,hour)=>new Date(Date.UTC(2020,0,1+i,hour)).toISOString();
 const symbol=market==='US'?'SYNTHETIC-US':'SYNTHETIC-SA',priceBasis='synthetic_adjusted';
 const bars=Array.from({length:n},(_,i)=>({sessionIndex:i,market,symbol,priceBasis,
  observedAt:observed(i,14),availableAt:observed(i,15),
  close:100*Math.exp(.0005*i+.03*Math.sin(i*.3)+.015*Math.cos(i*.71)),volume:10000+2000*Math.sin(i*.23)}));
 const other='SYNTHETIC-BRIDGE';
 const bridgeBars=Array.from({length:n},(_,i)=>({sessionIndex:i,market:'US',symbol:other,priceBasis,
  observedAt:observed(i,20),availableAt:observed(i,21),close:200*Math.exp(.0003*i+.02*Math.sin(i*.27)),volume:100000}));
 return {schemaVersion:1,market,symbol,currency:market==='US'?'USD':'SAR',priceBasis,
  calendarId:'SYNTHETIC-DAILY-NOT-AN-EXCHANGE',provenance:{source:'synthetic_fixture',pointInTime:true,adjustmentPolicy:'none_synthetic'},bars,
  bridgeSeries:[{id:'bridge',market:'US',symbol:other,priceBasis,provenance:{source:'synthetic_fixture',pointInTime:true},bars:bridgeBars}]};
}
