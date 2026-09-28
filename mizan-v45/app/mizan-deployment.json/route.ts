import identity from '@/lib/deployment-identity.json';
import {deploymentIdentityResponse} from '@/lib/deployment-identity';
export async function GET(){return deploymentIdentityResponse(identity);}
