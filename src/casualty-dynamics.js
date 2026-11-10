const clamp = (value,min,max) => Math.max(min,Math.min(max,value));

export function dampedJointResponse(seconds, { stiffness = 90, damping = 14, delay = 0 } = {}) {
  if(![seconds,stiffness,damping,delay].every(Number.isFinite)||seconds<0||stiffness<=0||damping<0||delay<0)
    throw new RangeError('Casualty joint response requires finite physical coefficients and elapsed time');
  const time=Math.max(0,seconds-delay),decay=damping/2,frequency=Math.sqrt(Math.max(.001,stiffness-decay*decay));
  return clamp(1-Math.exp(-decay*time)*(Math.cos(frequency*time)+decay/frequency*Math.sin(frequency*time)),0,1.08);
}

export function casualtyJointDynamics(casualty,now) {
  if(!casualty||!Number.isFinite(casualty.duration)||casualty.duration<=0||
    !Number.isFinite(now)||!Number.isFinite(casualty.time)||now<casualty.time)
    throw new RangeError('Invalid casualty dynamics clock');
  const elapsed=now-casualty.time,progress=clamp(elapsed/casualty.duration,0,1);
  const settled=progress===1;
  const side=casualty.variant%2?1:-1,variation=casualty.fold??.5;
  const response=(stiffness,damping,delay)=>settled?1:dampedJointResponse(elapsed,{stiffness,damping,delay});
  return { pelvis:response(72,12,.025),chest:response(60,10,.08),head:response(45,8,.15),
    leftArm:response(90,14,.035+variation*.04),rightArm:response(76,13,.09-variation*.03),
    leftKnee:response(120,14,.01),rightKnee:response(80,12,.045),
    twist:side*(.14+variation*.16),settled,progress };
}
