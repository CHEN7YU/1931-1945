import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage();
  await page.route('**/__voice-decode',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Voice decode check</title>'}));
  const origin=process.env.GAME_URL??'http://127.0.0.1:5203';
  await page.goto(origin+'/__voice-decode');
  const result=await page.evaluate(async()=>{
    const context=new AudioContext(),result=[];
    try{
      for(const file of ['girl-1','girl-2','boy-1','boy-2','opening-girl-1','opening-boy-1']){
        const response=await fetch('/assets/audio/civilian-voices/'+file+'.mp3');
        if(!response.ok)throw Error('Missing expressive recording '+file);
        const buffer=await context.decodeAudioData(await response.arrayBuffer());
        let peak=0;for(const sample of buffer.getChannelData(0))peak=Math.max(peak,Math.abs(sample));
        result.push({file,duration:buffer.duration,rate:buffer.sampleRate,peak,channels:buffer.numberOfChannels});
      }
    }finally{await context.close();}
    return result;
  });
  assert.equal(result.length,6);
  assert.ok(result.every(clip=>clip.duration>1&&clip.duration<15&&clip.peak>.02&&clip.peak<=1&&clip.channels===1));
  console.log(JSON.stringify({result,note:'Browser decoding and signal validity only; not a claim of human-reviewed acting quality.'}));
}finally{await browser.close();}
