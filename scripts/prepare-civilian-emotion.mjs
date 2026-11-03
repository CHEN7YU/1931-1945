import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {azureToken,voiceSSML,VOICE_FORMAT} from './prepare-battle-voices.mjs';
import {civilianVoiceClips} from '../src/civilian-voice-lines.js';

const directory=process.env.CIVILIAN_EMOTION_DIR;
if(!directory)throw new Error('Set CIVILIAN_EMOTION_DIR to a private audition directory');
const region=process.env.AZURE_SPEECH_REGION,resource=process.env.AZURE_SPEECH_RESOURCE_ID;
if(!/^[a-z0-9]+$/.test(region??'')||!/^\/subscriptions\/[a-f0-9-]+\/resourceGroups\/[\w.-]+\/providers\/Microsoft\.CognitiveServices\/accounts\/[\w.-]+$/i.test(resource??''))
  throw new Error('Use the existing authorized Speech resource and region');
await mkdir(directory,{recursive:true});
const sourcePath=resolve('public\\assets\\audio\\civilian-voices\\source.json');
const manifest=JSON.parse(await readFile(sourcePath,'utf8'));
const selected=['girl-1','boy-1','girl-2','boy-2','opening-girl-1','opening-boy-1'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
if(process.argv.includes('--install')){
  const ledger=JSON.parse(await readFile(join(directory,'emotion-generation.json'),'utf8'));
  if(ledger.files.length!==selected.length)throw new Error('Expressive batch is incomplete');
  for(const entry of ledger.files){
    const clip=civilianVoiceClips().find(clip=>clip.file===entry.file),bytes=await readFile(join(directory,entry.file));
    if(!clip||hash(bytes)!==entry.sha256||hash(`${VOICE_FORMAT}\n${voiceSSML(clip)}`)!==entry.synthesisHash)
      throw new Error('Expressive take does not match the live clip definition');
    await writeFile(resolve('public\\assets\\audio\\civilian-voices',entry.file),bytes);
    const index=manifest.files.findIndex(file=>file.file===entry.file);
    if(index<0)throw new Error('Expressive take must replace an existing known clip');
    manifest.files[index]={...clip,...entry,processing:'Stock fearful style at degree 2 with urgent cadence and short phrase breaks; no cloned or historical voice.'};
  }
  manifest.generatedAt=new Date().toISOString();
  await writeFile(sourcePath,JSON.stringify(manifest,null,2)+'\n');
  console.log('Installed six verified expressive takes; all other civilian audio remains byte-identical.');
  process.exit(0);
}
const authorization=`Bearer aad#${resource}#${azureToken()}`;
const capabilities=await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`,
  {headers:{Authorization:authorization},signal:AbortSignal.timeout(30000)});
if(!capabilities.ok)throw new Error(`Azure emotion capabilities HTTP ${capabilities.status}`);
const voices=await capabilities.json();
const clips=civilianVoiceClips().filter(clip=>selected.includes(clip.id)).map(clip=>({...clip,
  style:'fearful',styledegree:'2',rate:clip.age==='child'?'+16%':'+12%',volume:'loud',pauseMs:110}));
if(clips.length!==selected.length)throw new Error('Missing selected civilian emotion lines');
for(const clip of clips){
  const voice=voices.find(voice=>voice.ShortName===clip.voice);
  if(!voice?.StyleList?.includes(clip.style)||!voice?.RolePlayList?.includes(clip.role))
    throw new Error(`Unsupported expressive age role for ${clip.file}`);
}
const ledgerPath=join(directory,'emotion-generation.json');
let ledger={resource,authorizedFrom:'Existing civilian Speech authorization, within recorded per-phase character limits',
  characterLimit:6000,attempted:0,files:[]};
try{ledger=JSON.parse(await readFile(ledgerPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
for(const clip of clips){
  const ssml=voiceSSML(clip),synthesisHash=hash(`${VOICE_FORMAT}\n${ssml}`);
  const old=ledger.files.find(file=>file.file===clip.file&&file.synthesisHash===synthesisHash);
  if(old){if(hash(await readFile(join(directory,clip.file)))!==old.sha256)throw new Error('Audition cache hash mismatch');continue;}
  if(ledger.attempted+ssml.length>ledger.characterLimit||
    manifest.attemptedCharactersByPhase[clip.phase]+ssml.length>manifest.requestSSMLCharacterLimit)
    throw new Error('Expressive audition request budget exhausted');
  ledger.attempted+=ssml.length;
  manifest.attemptedSSMLCharacters+=ssml.length;
  manifest.attemptedCharactersByPhase[clip.phase]+=ssml.length;
  await writeFile(ledgerPath,JSON.stringify(ledger,null,2)+'\n');
  await writeFile(sourcePath,JSON.stringify(manifest,null,2)+'\n');
  const response=await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,{
    method:'POST',headers:{Authorization:authorization,'Content-Type':'application/ssml+xml','X-Microsoft-OutputFormat':VOICE_FORMAT},
    body:ssml,signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw new Error(`Expressive civilian audition ${clip.file}: Azure HTTP ${response.status}; not retried`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length<500||!(bytes.subarray(0,3).toString()==='ID3'||bytes[0]===255&&(bytes[1]&224)===224))
    throw new Error('Invalid expressive speech MP3');
  await writeFile(join(directory,clip.file),bytes);
  ledger.files.push({...clip,synthesisHash,sha256:hash(bytes),bytes:bytes.length});
  await writeFile(ledgerPath,JSON.stringify(ledger,null,2)+'\n');
  console.log(`Prepared expressive take ${clip.file}`);
}
console.log('Six bounded expressive takes prepared; existing audio files were not overwritten.');
