-----------------------------------

{supercollider/june 2023};

----------------------

{|j|play{RLPF.ar(Pulse.ar(f=32**sum({|i|1/4**i*abs(LFNoise0.kr(0.25**j/8)>0-LFPulse.ar(2**i/8))}!10)*30,0.3),f.sqrt.lag(2)*30,0.5)!2/5}}!4

----------------------------------

play{Splay.ar({Pluck.ar(BPF.ar(f=product({|i|product({LFPulse.ar(2**rrand(-9,1),2.rand/2)}!(i+2))/(1+i)+1}!8)*86,f).sin,Saw.ar,1,1/f,9)}!9)}

------------------------------------------------------------------------

play{x=Saw.ar(0.7**lag(kr(n=LFNoise0,1/5),2)*[601,500,749]);Splay.ar({|i|x=x+BAllPass.ar(x,9**n.kr(a=1b**i)*2e3)+CombL.ar(x,1,a,8)/2s}!9@8)}

------------------------------------------------------------------------

x=(1..8);y=scramble(8/x);z=y/.x y;d={|d,a|Duty.ar(d,0,Dseq(a,inf))};play{d.(d.(0.16,z*.x z)/4e3,z)/5-d.(d.(0.04,x*2)/8e2,[0,1])/3!2}//

-------------------------------------------------------------------------

Pbind(\dur,1/6,\note,Pseq(stutter(x=[0,7,12,7,-2,5,10,5,-7,0,5,7,8,7,5];x=x++7++x++3!4;y=0!8++[5,3,2,0,3,2,0,-2]+5!4;flat(x++y)-8),4)).play

-----------------------------------------------------------------------

t={|u,d,a|u.ar(Duty.ar(d/5,0,Dseq(a++0))*300)};play{t.(Saw,1,x=[6,5,9,8];flat(y=allTuples(x/.t x)[(127..0)+[0,127]]%1))+t.(LFTri,4,y*2)!2/6}

------------------------------------------------------------------

play{Splay.ar({|i|f=1.9**i/128;BPF.ar(PinkNoise.ar(1!2),4**LFNoise2.kr(1.2**i/16)*300,0.15)*(5**LFNoise2.ar(f)/(i+8)*20)}!15)}

-------------------------------------------------------------------

Ndef(\,{x=DelayN.ar(LeakDC.ar(Ndef(\).ar),1,z=1e-2);LPF.ar(Trig1.ar(Amplitude.kr(x,5,120)*1.5+x+z-Dust.ar(2),4e-3)*0.1+x*0.99,1200)}).play





{supercollider/april 2023};

----------------------

d={|l,h,f,p,n|sum({Ringz.ar(LFPulse.ar(f,p,0.01),exprand(l,h).round(n),0.5)}!20)};{d.(50,150,[2,1,1],[0,1/4,3/4],[1,40,50])*3e-4!2}.play

--------------------------------------------

x=0;Pbind(*[type:\set,id:{|freq=10|f=freq;LPF.ar(Saw.ar(f),f.lag(1)*3)!2}.play.nodeID,freq:Pfunc{x=x+32%35;x%12+1*40},dur:1/6]).play

----------------------------------

Ndef('x',{Normalizer.ar(FreqShift.ar(Rotate2.ar(*Ndef('x').ar++1/8).tanh,20*[-3,0.995])+Dust.ar(1!2,0.005),1,0.5)}).play//

-------------------------------------------

f=g=0;Routine({loop{g=g+1e-3;f=f+g%1;play{l=Line.kr(1,0,3,doneAction:2);h=2**f*100;e=Pluck.ar(CuspL.ar,1,i=1/h,i,2,0.3)!2};0.15.wait}}).play

-------------------------------------------

p=SCImage(n=300);n.do{|i|n.do{|j|z=c=Complex(i-240,j-150)/n*2.5;{(r=rho(z=z*z+c)/8)>1&&{z=0}}!200;p.setColor(Color.hsv(r,1,1),i,j)}};p.plot




{supercollider/dec 2022};

-------------------

Ndef(\,{LPF.ar(x=DelayN.ar(LeakDC.ar(Ndef(\).ar,1-2e-7)*0.99,1,0.1)+Dust.ar(0.5!2);x+(Trig1.ar(x<(x.mean.lag(30)),4e-3)*0.05),800)}).play

-------------------------------------------

Ndef(\,{Limiter.ar(x=LeakDC.ar(Ndef(\).ar)+Impulse.ar(0);x-DelayC.ar(x=x.sum/8,1,1/Tartini.kr(x)[0].lag(1.5)),0.5,0.02*[1,1.1])}).play

-------------------------------------------

Ndef('x',{x=(Ndef('x').ar*1.8).tanh;BPF.ar(x+[0.01,0.1],12**Latch.ar(x.mean,Impulse.ar(3)).lag(0.1)*200)}).play//

-------------------------------------------

a=1@2;f=1;w=Window().front.drawHook_({900.do{Pen.line(a*200,(a=(a*(f=f+2e-6)).y.cos+1@a.x)*200)};Pen.stroke});AppClock.play{w.refresh;0.01}

-------------------------------------------

{a=LFTri.ar(1);20.do{a=BAllPass.ar(a,80,1);a=((a+0.02)*LFNoise0.kr(1/2)*8).tanh;a=LeakDC.ar(a,0.995)};a*0.1!2}.play// 

-------------------------------------------

n={|r,f,n=0,d=1|round(r**LFNoise0.ar([4,1,8,2]!d)*f,n)};play{Splay.ar(d=n.(3,0.6);Ringz.ar(d*0.01,n.(2,n.(20,400),40,20),d).mean.tanh)}

-------------------------------------------

t=LFTri;play{RLPFD.ar(Trig1.ar(SinOsc.ar(1/8)+1*1.5*t.ar([800,801])+t.ar(1e3),t.ar(1/2).range(1e-4,1/180))*2,2**t.ar(1/[3,4])*1200,0.3,0.6)}

-------------------------------------------

p={|f,a=5|GVerb.ar(LFPulse.ar(f)*a)+f};play{tanh(HPF.ar(p.(99-p.(1/2,20)*(1+p.(2,1/5))+p.(4+p.(1/2)),0.5),80,XLine.kr(4e-4,1/8,61,1,0,2)))}

------------------------------------------