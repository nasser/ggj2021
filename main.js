import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.124.0/build/three.module.js"
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.124.0/examples/jsm/controls/OrbitControls.js"
import { EffectComposer } from 'https://cdn.jsdelivr.net/npm/three@0.124.0/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://cdn.jsdelivr.net/npm/three@0.124.0/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'https://cdn.jsdelivr.net/npm/three@0.124.0/examples/jsm/postprocessing/ShaderPass.js';

let scene = new THREE.Scene()

let camera = new THREE.PerspectiveCamera(75)
camera.near = 0.01
camera.position.y = 4
camera.position.z = 20

let renderer = new THREE.WebGLRenderer(  )
document.body.appendChild(renderer.domElement)

window.onresize = function () {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
}
window.onresize()

scene.add(new THREE.GridHelper(50, 50))
new OrbitControls(camera, renderer.domElement)

const geometry = new THREE.BoxGeometry( 10, 10, 10 );
const material = new THREE.MeshLambertMaterial( { color: 0x00ff00 } );
const cube = new THREE.Mesh( geometry, material );
cube.position.y -= 5
scene.add( cube );

scene.add( new THREE.AmbientLight( 0x404040 ) );

const directionalLight = new THREE.DirectionalLight( 0xffffff, 0.5 );
scene.add( directionalLight );
directionalLight.position.set(4, 2, 4)

let composer = new EffectComposer( renderer );
composer.addPass( new RenderPass( scene, camera ))

let target = new THREE.WebGLRenderTarget( window.innerWidth, window.innerHeight );
target.texture.format = THREE.RGBFormat;
target.texture.minFilter = THREE.NearestFilter;
target.texture.magFilter = THREE.NearestFilter;
target.texture.generateMipmaps = false;
target.stencilBuffer = false;
target.depthBuffer = true;
target.depthTexture = new THREE.DepthTexture();

let depthShader = new ShaderPass({
    uniforms: {
        tDepth: { value: null },
        tDiffuse: { value: null },
        cameraNear: { value: 0 },
        cameraFar: { value: 0 },
        t: { value: 0.5 }
    },
    vertexShader: 
        `varying vec2 vUv;

        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }`,
    fragmentShader: 
        `#include <packing>
        
        uniform sampler2D tDiffuse;
        uniform sampler2D tDepth;
        uniform float t;
        varying vec2 vUv;
        uniform float cameraNear;
        uniform float cameraFar;


        vec4 readDepth( sampler2D depthSampler, vec2 coord ) {
            float fragCoordZ = texture2D( depthSampler, coord ).x;
            float viewZ = perspectiveDepthToViewZ( fragCoordZ, cameraNear, cameraFar );
            float d = 1.-fragCoordZ;//viewZToOrthographicDepth( viewZ, cameraNear, cameraFar );
            return vec4(d, d, d, 1.);
        }

        void main() {
            vec4 color = texture2D( tDiffuse, vUv );
            vec4 depth = readDepth( tDepth, vUv );
            gl_FragColor = mix(color, depth, t);
        }`
})
depthShader.uniforms.tDepth.value = target.depthTexture;
depthShader.uniforms.cameraNear.value = camera.near;
depthShader.uniforms.cameraFar.value = camera.far;

composer.addPass(depthShader);
renderer.setRenderTarget( target );

let rayMarchShader = new ShaderPass({
    uniforms: {
        iResolution: { value: [window.innerWidth, window.innerHeight, 1] },
        iTime: { value: 5 },
        tDepth: { value: null },
        tDiffuse: { value: null },
        cameraNear: { value: 0 },
        cameraFar: { value: 0 },
        cameraAngle: { value: [0, 0, 0] },
        cameraOrigin: { value: [0, 10, 1] },
    
    },
    vertexShader: 
        `varying vec2 vUv;

        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }`,
    fragmentShader:
        `#include <packing>
        
        uniform vec3 iResolution;
        uniform vec2 iMouse;
        uniform float iTime;

        uniform vec3 cameraAngle;
        uniform vec3 cameraOrigin;

        varying vec2 vUv;
        uniform sampler2D tDiffuse;
        uniform sampler2D tDepth;
        uniform float cameraNear;
        uniform float cameraFar;

        /*
         * "Seascape" by Alexander Alekseev aka TDM - 2014
         * License Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported License.
         * Contact: tdmaav@gmail.com
         */

        const int NUM_STEPS = 8;
        const float PI	 	= 3.141592;
        const float EPSILON	= 1e-3;
        #define EPSILON_NRM (0.1 / iResolution.x)

        // sea
        const int ITER_GEOMETRY = 1;
        const int ITER_FRAGMENT = 2;
        const float SEA_HEIGHT = 0.6;
        const float SEA_CHOPPY = 4.0;
        const float SEA_SPEED = 0.8;
        const float SEA_FREQ = 0.16;
        const vec3 SEA_BASE = vec3(0.0,0.09,0.18);
        const vec3 SEA_WATER_COLOR = vec3(0.8,0.9,0.6)*0.6;
        #define SEA_TIME (1.0 + iTime * SEA_SPEED)
        const mat2 octave_m = mat2(1.6,1.2,-1.2,1.6);

        // math
        mat3 fromEuler(vec3 ang) {
            vec2 a1 = vec2(sin(ang.x),cos(ang.x));
            vec2 a2 = vec2(sin(ang.y),cos(ang.y));
            vec2 a3 = vec2(sin(ang.z),cos(ang.z));
            mat3 m;
            m[0] = vec3(a1.y*a3.y+a1.x*a2.x*a3.x,a1.y*a2.x*a3.x+a3.y*a1.x,-a2.y*a3.x);
            m[1] = vec3(-a2.y*a1.x,a1.y*a2.y,a2.x);
            m[2] = vec3(a3.y*a1.x*a2.x+a1.y*a3.x,a1.x*a3.x-a1.y*a3.y*a2.x,a2.y*a3.y);
            return m;
        }
        float hash( vec2 p ) {
            float h = dot(p,vec2(127.1,311.7));	
            return fract(sin(h)*43758.5453123);
        }
        float noise( in vec2 p ) {
            vec2 i = floor( p );
            vec2 f = fract( p );	
            vec2 u = f*f*(3.0-2.0*f);
            return -1.0+2.0*mix( mix( hash( i + vec2(0.0,0.0) ), 
                            hash( i + vec2(1.0,0.0) ), u.x),
                        mix( hash( i + vec2(0.0,1.0) ), 
                            hash( i + vec2(1.0,1.0) ), u.x), u.y);
        }

        // lighting
        float diffuse(vec3 n,vec3 l,float p) {
            return pow(dot(n,l) * 0.4 + 0.6,p);
        }
        float specular(vec3 n,vec3 l,vec3 e,float s) {    
            float nrm = (s + 8.0) / (PI * 8.0);
            return pow(max(dot(reflect(e,n),l),0.0),s) * nrm;
        }

        // sky
        vec3 getSkyColor(vec3 e) {
            e.y = (max(e.y,0.0)*0.8+0.2)*0.8;
            return vec3(pow(1.0-e.y,2.0), 1.0-e.y, 0.6+(1.0-e.y)*0.4) * 1.1;
        }

        // sea
        float sea_octave(vec2 uv, float choppy) {
            uv += noise(uv);        
            vec2 wv = 1.0-abs(sin(uv));
            vec2 swv = abs(cos(uv));    
            wv = mix(wv,swv,wv);
            return pow(1.0-pow(wv.x * wv.y,0.65),choppy);
        }

        float map(vec3 p) {
            float freq = SEA_FREQ;
            float amp = SEA_HEIGHT;
            float choppy = SEA_CHOPPY;
            vec2 uv = p.xz; uv.x *= 0.75;
            
            float d, h = 0.0;    
            for(int i = 0; i < ITER_GEOMETRY; i++) {        
                d = sea_octave((uv+SEA_TIME)*freq,choppy);
                d += sea_octave((uv-SEA_TIME)*freq,choppy);
                h += d * amp;        
                uv *= octave_m; freq *= 1.9; amp *= 0.22;
                choppy = mix(choppy,1.0,0.2);
            }
            return p.y - h;
        }

        float map_detailed(vec3 p) {
            float freq = SEA_FREQ;
            float amp = SEA_HEIGHT;
            float choppy = SEA_CHOPPY;
            vec2 uv = p.xz; uv.x *= 0.75;
            
            float d, h = 0.0;    
            for(int i = 0; i < ITER_FRAGMENT; i++) {        
                d = sea_octave((uv+SEA_TIME)*freq,choppy);
                d += sea_octave((uv-SEA_TIME)*freq,choppy);
                h += d * amp;        
                uv *= octave_m; freq *= 1.9; amp *= 0.22;
                choppy = mix(choppy,1.0,0.2);
            }
            return p.y - h;
        }

        vec3 getSeaColor(vec3 p, vec3 n, vec3 l, vec3 eye, vec3 dist) {  
            float fresnel = clamp(1.0 - dot(n,-eye), 0.0, 1.0);
            fresnel = pow(fresnel,3.0) * 0.5;
                
            vec3 reflected = getSkyColor(reflect(eye,n));    
            vec3 refracted = SEA_BASE + diffuse(n,l,80.0) * SEA_WATER_COLOR * 0.12; 
            
            vec3 color = mix(refracted,reflected,fresnel);
            
            float atten = max(1.0 - dot(dist,dist) * 0.001, 0.0);
            color += SEA_WATER_COLOR * (p.y - SEA_HEIGHT) * 0.18 * atten;
            
            color += vec3(specular(n,l,eye,60.0));
            
            return color;
        }

        // tracing
        vec3 getNormal(vec3 p, float eps) {
            vec3 n;
            n.y = map_detailed(p);    
            n.x = map_detailed(vec3(p.x+eps,p.y,p.z)) - n.y;
            n.z = map_detailed(vec3(p.x,p.y,p.z+eps)) - n.y;
            n.y = eps;
            return normalize(n);
        }

        float heightMapTracing(vec3 ori, vec3 dir, out vec3 p) {  
            float tm = 0.0;
            float tx = 1000.0;    
            float hx = map(ori + dir * tx);
            if(hx > 0.0) return tx;   
            float hm = map(ori + dir * tm);    
            float tmid = 0.0;
            for(int i = 0; i < NUM_STEPS; i++) {
                tmid = mix(tm,tx, hm/(hm-hx));                   
                p = ori + dir * tmid;                   
                float hmid = map(p);
                if(hmid < 0.0) {
                    tx = tmid;
                    hx = hmid;
                } else {
                    tm = tmid;
                    hm = hmid;
                }
            }
            return tmid;
        }

        vec3 getPixel(in vec2 coord) {    
            float time = 0.;
            vec2 uv = coord / iResolution.xy;
            uv = uv * 2.0 - 1.0;
            uv.x *= iResolution.x / iResolution.y;    
                
            // ray
            vec3 ang = cameraAngle;
            vec3 ori = cameraOrigin;
            vec3 dir = normalize(vec3(uv.xy,-2.0)); dir.z += length(uv) * 0.14;
            dir = normalize(dir) * fromEuler(ang);
            
            // tracing
            vec3 p;
            heightMapTracing(ori,dir,p);
            vec3 dist = p - ori;
            vec3 n = getNormal(p, dot(dist,dist) * EPSILON_NRM);
            vec3 light = normalize(vec3(0.0,1.0,0.8)); 
                    
            // color
            return mix(
                getSkyColor(dir),
                getSeaColor(p,n,light,dir,dist),
                pow(smoothstep(0.0,-0.02,dir.y),0.2));
        }

        vec3 getDistance(in vec2 coord) {   
            float time = 0.; 
            vec2 uv = coord / iResolution.xy;
            uv = uv * 2.0 - 1.0;
            uv.x *= iResolution.x / iResolution.y;    
                
            // ray
            vec3 ang = cameraAngle;
            vec3 ori = cameraOrigin;
            vec3 dir = normalize(vec3(uv.xy,-2.0)); dir.z += length(uv) * 0.14;
            dir = normalize(dir) * fromEuler(ang);
            
            // tracing
            vec3 p;
            heightMapTracing(ori,dir,p);
            vec3 dist = p - ori;
            return dist;
        }

        // main
        void mainImage( out vec4 fragColor, out float distance, in vec2 fragCoord ) {
            float time = iTime * 0.3 + iMouse.x*0.01;
            
            vec3 color = getPixel(fragCoord);
            fragColor = vec4(pow(color,vec3(0.65)), 1.0);
            distance = length(getDistance(fragCoord));
        }

        float readDepth( sampler2D depthSampler, vec2 coord ) {
            float fragCoordZ = texture2D( depthSampler, coord ).x;
            float viewZ = perspectiveDepthToViewZ( fragCoordZ, cameraNear, cameraFar );
            float d = 1. - fragCoordZ;
            return 1. - (d * 100.);
        }

        void main() {
            vec4 rayMarchColor;
            float rayMarchDistance;
            mainImage(rayMarchColor, rayMarchDistance, gl_FragCoord.xy);
            
            rayMarchDistance /= 10.;
            rayMarchDistance = clamp(rayMarchDistance, 0., 1.);
            vec4 sceneColor = texture2D( tDiffuse, vUv );
            float sceneDistance = clamp(readDepth( tDepth, vUv ), 0., 1.);
            if(rayMarchDistance < sceneDistance || sceneDistance > 0.9999999) {
                gl_FragColor = rayMarchColor;
            } else {
                gl_FragColor = sceneColor;
            }
            
            // gl_FragColor = vec4(sceneDistance, sceneDistance, sceneDistance, 1.);
            // gl_FragColor = vec4(rayMarchDistance, rayMarchDistance, rayMarchDistance, 1.);
        }`
})

rayMarchShader.uniforms.tDepth.value = target.depthTexture;
rayMarchShader.uniforms.cameraNear.value = camera.near;
rayMarchShader.uniforms.cameraFar.value = camera.far;

composer.addPass(rayMarchShader);

export function render() {
    requestAnimationFrame(render)
    rayMarchShader.uniforms.iTime.value += 0.01
    rayMarchShader.uniforms.cameraOrigin.value = [camera.position.x, camera.position.y, camera.position.z]
    rayMarchShader.uniforms.cameraAngle.value = [-camera.rotation.z, -camera.rotation.x, -camera.rotation.y]
    renderer.render( scene, camera );
    composer.render();
}