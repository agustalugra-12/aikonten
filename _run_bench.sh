#!/bin/bash
export PATH=/home/admin/.nvm/versions/node/v20.20.2/bin:$PATH
cd /home/admin/kp-vplan
npx tsx _vplan_bench.ts "$1" > /home/admin/vplan-bench-$1.log 2>&1
echo "EXIT=$?" >> /home/admin/vplan-bench-$1.log
