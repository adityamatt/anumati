import { describe, it, expect } from "vitest";
import { matchAws } from "../../src/matchers/aws.js";

describe("matchAws — logs (allow read-only)", () => {
  it("describe-log-groups with query/output flags", () => {
    expect(
      matchAws(
        `aws logs describe-log-groups --profile drashta-alpha --region eu-central-1 --query "logGroups[?contains(logGroupName, 'RunFile')].logGroupName" --output text`,
      ),
    ).toBe(true);
  });

  it("filter-log-events", () => {
    expect(
      matchAws(
        `aws logs filter-log-events --log-group-name "/aws/lambda/dev-adityatx-Drashta-QueryRunnerRunFileHandler" --profile drashta-alpha --region eu-central-1`,
      ),
    ).toBe(true);
  });

  it("get-log-events", () => {
    expect(matchAws("aws logs get-log-events --log-group-name x --log-stream-name y")).toBe(true);
  });
});

describe("matchAws — stepfunctions (allow read-only)", () => {
  it("describe-execution", () => {
    expect(matchAws('aws stepfunctions describe-execution --execution-arn "arn:aws:states:eu-central-1:1:execution:x:y"')).toBe(true);
  });
  it("list-executions", () => {
    expect(matchAws('aws stepfunctions list-executions --state-machine-arn "arn:aws:states:eu-central-1:1:stateMachine:x"')).toBe(true);
  });
  it("list-map-runs", () => {
    expect(matchAws('aws stepfunctions list-map-runs --execution-arn "arn:aws:states:eu-central-1:1:execution:x:y"')).toBe(true);
  });
  it("describe-map-run", () => {
    expect(matchAws('aws stepfunctions describe-map-run --map-run-arn "arn:aws:states:x"')).toBe(true);
  });
});

describe("matchAws — s3 / s3api (allow pure reads)", () => {
  it("s3 ls", () => expect(matchAws("aws s3 ls")).toBe(true));
  it("s3 ls with a bucket prefix", () => expect(matchAws("aws s3 ls s3://my-bucket/prefix/")).toBe(true));
  it("s3api list-objects-v2", () => expect(matchAws("aws s3api list-objects-v2 --bucket my-bucket")).toBe(true));
  it("s3api head-object", () => expect(matchAws("aws s3api head-object --bucket b --key k")).toBe(true));
  it("s3api get-bucket-location", () => expect(matchAws("aws s3api get-bucket-location --bucket b")).toBe(true));
  it("s3api get-bucket-encryption", () =>
    expect(
      matchAws('aws s3api get-bucket-encryption --profile drashta-prod --region us-east-1 --bucket vst-forecast-na-prod-051370627181-us-east-1'),
    ).toBe(true));
  it("s3api get-public-access-block", () => expect(matchAws("aws s3api get-public-access-block --bucket b")).toBe(true));
});

describe("matchAws — sts (allow read-only)", () => {
  it("get-caller-identity", () =>
    expect(matchAws("aws sts get-caller-identity --profile drashta-prod")).toBe(true));
});

describe("matchAws — sts (block credential-minting)", () => {
  it("assume-role", () => expect(matchAws("aws sts assume-role --role-arn arn:x --role-session-name s")).toBe(false));
  it("get-session-token", () => expect(matchAws("aws sts get-session-token")).toBe(false));
  it("get-federation-token", () => expect(matchAws("aws sts get-federation-token --name n")).toBe(false));
});

describe("matchAws — iam (allow read-only)", () => {
  it("list-role-policies", () =>
    expect(matchAws('aws iam list-role-policies --profile drashta-prod --role-name "DrashtaProdAppStack-query-worker-role" --output text')).toBe(true));
  it("list-attached-role-policies", () =>
    expect(matchAws('aws iam list-attached-role-policies --role-name x --query "AttachedPolicies[].PolicyName" --output text')).toBe(true));
  it("get-role-policy", () =>
    expect(matchAws('aws iam get-role-policy --role-name "DrashtaProdAppStack-query-worker-role" --policy-name P --output json')).toBe(true));
  it("list-users", () => expect(matchAws("aws iam list-users")).toBe(true));
  it("get-policy", () => expect(matchAws("aws iam get-policy --policy-arn arn:x")).toBe(true));
});

describe("matchAws — iam (block writes)", () => {
  it("create-role", () => expect(matchAws("aws iam create-role --role-name x --assume-role-policy-document '{}'")).toBe(false));
  it("delete-role", () => expect(matchAws("aws iam delete-role --role-name x")).toBe(false));
  it("attach-role-policy", () => expect(matchAws("aws iam attach-role-policy --role-name x --policy-arn arn:y")).toBe(false));
  it("put-role-policy", () => expect(matchAws("aws iam put-role-policy --role-name x --policy-name p --policy-document '{}'")).toBe(false));
  it("create-access-key", () => expect(matchAws("aws iam create-access-key --user-name u")).toBe(false));
  it("delete-user", () => expect(matchAws("aws iam delete-user --user-name u")).toBe(false));
});

describe("matchAws — s3 / s3api (block writes & local side effects)", () => {
  it("s3 cp upload", () => expect(matchAws("aws s3 cp . s3://b/k")).toBe(false));
  it("s3 cp download (writes local file)", () => expect(matchAws("aws s3 cp s3://b/k .")).toBe(false));
  it("s3 sync", () => expect(matchAws("aws s3 sync . s3://b")).toBe(false));
  it("s3 rm", () => expect(matchAws("aws s3 rm s3://b/k")).toBe(false));
  it("s3 mb (make bucket)", () => expect(matchAws("aws s3 mb s3://b")).toBe(false));
  it("s3api get-object (writes local file)", () => expect(matchAws("aws s3api get-object --bucket b --key k out.json")).toBe(false));
  it("s3api put-object", () => expect(matchAws("aws s3api put-object --bucket b --key k")).toBe(false));
  it("s3api delete-object", () => expect(matchAws("aws s3api delete-object --bucket b --key k")).toBe(false));
});

describe("matchAws — compound shapes", () => {
  it("cd <dir> && aws logs ...", () => {
    expect(matchAws("cd /tmp && aws logs describe-log-groups --region eu-central-1")).toBe(true);
  });
  it("aws ... | grep", () => {
    expect(matchAws("aws stepfunctions list-executions --state-machine-arn arn:x | grep RUNNING")).toBe(true);
  });
  it("aws ... | jq", () => {
    expect(matchAws("aws logs filter-log-events --log-group-name x | jq '.events'")).toBe(true);
  });
  it("safe stream redirect 2>/dev/null", () => {
    expect(matchAws("aws logs describe-log-groups 2>/dev/null")).toBe(true);
  });
});

describe("matchAws — block writes / mutations", () => {
  it("stepfunctions start-execution", () => {
    expect(matchAws('aws stepfunctions start-execution --state-machine-arn arn:x')).toBe(false);
  });
  it("stepfunctions stop-execution", () => {
    expect(matchAws('aws stepfunctions stop-execution --execution-arn arn:x')).toBe(false);
  });
  it("stepfunctions delete-state-machine", () => {
    expect(matchAws('aws stepfunctions delete-state-machine --state-machine-arn arn:x')).toBe(false);
  });
  it("logs delete-log-group", () => {
    expect(matchAws('aws logs delete-log-group --log-group-name x')).toBe(false);
  });
  it("logs put-log-events", () => {
    expect(matchAws('aws logs put-log-events --log-group-name x --log-stream-name y')).toBe(false);
  });
  it("logs create-log-group", () => {
    expect(matchAws('aws logs create-log-group --log-group-name x')).toBe(false);
  });
});

describe("matchAws — dynamodb (allow read-only)", () => {
  it("get-item", () => expect(matchAws("aws dynamodb get-item --table-name x --key '{}'")).toBe(true));
  it("query", () => expect(matchAws('aws dynamodb query --table-name x --key-condition-expression "pk = :p"')).toBe(true));
  it("scan with filter/projection flags", () => {
    expect(
      matchAws(
        `aws dynamodb scan --profile drashta-prod --region eu-central-1 --table-name "DrashtaProdAppStack-config" --filter-expression "begins_with(sk, :f)" --expression-attribute-values '{":f":{"S":"file#"}}' --output json`,
      ),
    ).toBe(true);
  });
  it("batch-get-item", () => expect(matchAws("aws dynamodb batch-get-item --request-items '{}'")).toBe(true));
  it("describe-table", () => expect(matchAws("aws dynamodb describe-table --table-name x")).toBe(true));
  it("list-tables", () => expect(matchAws("aws dynamodb list-tables")).toBe(true));
});

describe("matchAws — dynamodb (block writes)", () => {
  it("put-item", () => expect(matchAws("aws dynamodb put-item --table-name x --item '{}'")).toBe(false));
  it("update-item", () => expect(matchAws("aws dynamodb update-item --table-name x --key '{}'")).toBe(false));
  it("delete-item", () => expect(matchAws("aws dynamodb delete-item --table-name x --key '{}'")).toBe(false));
  it("batch-write-item", () => expect(matchAws("aws dynamodb batch-write-item --request-items '{}'")).toBe(false));
  it("delete-table", () => expect(matchAws("aws dynamodb delete-table --table-name x")).toBe(false));
  it("execute-statement (PartiQL, can mutate)", () => {
    expect(matchAws(`aws dynamodb execute-statement --statement "SELECT * FROM x"`)).toBe(false);
  });
});

describe("matchAws — lambda (allow read-only)", () => {
  it("get-function-configuration with query flags", () => {
    expect(
      matchAws(
        `aws lambda get-function-configuration --profile drashta-prod --region eu-central-1 --function-name "DrashtaProdAppStack-QueryRunnerRunFileHandler60586-THdlLFGiJ3R3" --query "{VpcConfig:VpcConfig,Timeout:Timeout}" --output json`,
      ),
    ).toBe(true);
  });
  it("get-function", () => expect(matchAws("aws lambda get-function --function-name x")).toBe(true));
  it("get-policy", () => expect(matchAws("aws lambda get-policy --function-name x")).toBe(true));
  it("list-functions", () => expect(matchAws("aws lambda list-functions")).toBe(true));
  it("list-event-source-mappings", () => expect(matchAws("aws lambda list-event-source-mappings --function-name x")).toBe(true));
});

describe("matchAws — lambda (block writes & invokes)", () => {
  it("invoke (executes & writes local response file)", () => {
    expect(matchAws("aws lambda invoke --function-name x out.json")).toBe(false);
  });
  it("invoke-async", () => expect(matchAws("aws lambda invoke-async --function-name x --invoke-args '{}'")).toBe(false));
  it("update-function-code", () => expect(matchAws("aws lambda update-function-code --function-name x")).toBe(false));
  it("update-function-configuration", () => expect(matchAws("aws lambda update-function-configuration --function-name x")).toBe(false));
  it("delete-function", () => expect(matchAws("aws lambda delete-function --function-name x")).toBe(false));
  it("create-function", () => expect(matchAws("aws lambda create-function --function-name x")).toBe(false));
  it("publish-version", () => expect(matchAws("aws lambda publish-version --function-name x")).toBe(false));
});

describe("matchAws — cloudformation (allow read-only)", () => {
  it("describe-stacks with query/output flags", () => {
    expect(
      matchAws(
        `aws cloudformation describe-stacks --profile drashta-alpha --region us-west-2 --stack-name BONESBootstrap-9690717-624351986350-us-west-2 --query "Stacks[0].StackStatus" --output text`,
      ),
    ).toBe(true);
  });
  it("list-stacks", () => {
    expect(
      matchAws(
        `aws cloudformation list-stacks --profile drashta-alpha --region us-west-2 --query "StackSummaries[?StackStatus!='DELETE_COMPLETE'].StackName" --output text`,
      ),
    ).toBe(true);
  });
  it("describe-stack-resources", () => {
    expect(
      matchAws(
        `aws cloudformation describe-stack-resources --profile drashta-alpha --region us-west-2 --stack-name BONESBootstrap-9690717-624351986350-us-west-2 --query "StackResources[?ResourceType=='AWS::IAM::Role'].PhysicalResourceId" --output text`,
      ),
    ).toBe(true);
  });
  it("describe-stacks | head", () => {
    expect(
      matchAws(
        `aws cloudformation describe-stacks --profile drashta-alpha --region us-west-2 --query "Stacks[?contains(StackName,'BONESBootstrap')].StackName" --output text | head`,
      ),
    ).toBe(true);
  });
  it("describe-stack-resources | tr | grep", () => {
    expect(
      matchAws(
        `aws cloudformation describe-stack-resources --profile drashta-prod --region us-west-2 --stack-name BONESBootstrap-9690717-879866610279-us-west-2 --query "StackResources[?ResourceType=='AWS::IAM::Role'].PhysicalResourceId" --output text | tr '\\t' '\\n' | grep -i "ChangeSetRole"`,
      ),
    ).toBe(true);
  });
});

describe("matchAws — cloudformation (block writes)", () => {
  it("create-stack", () =>
    expect(matchAws("aws cloudformation create-stack --stack-name x --template-body '{}'")).toBe(false));
  it("update-stack", () =>
    expect(matchAws("aws cloudformation update-stack --stack-name x --template-body '{}'")).toBe(false));
  it("delete-stack", () => expect(matchAws("aws cloudformation delete-stack --stack-name x")).toBe(false));
  it("deploy", () => expect(matchAws("aws cloudformation deploy --stack-name x --template-file t.yaml")).toBe(false));
  it("execute-change-set", () =>
    expect(matchAws("aws cloudformation execute-change-set --change-set-name c --stack-name x")).toBe(false));
  it("cancel-update-stack", () =>
    expect(matchAws("aws cloudformation cancel-update-stack --stack-name x")).toBe(false));
  it("set-stack-policy", () =>
    expect(matchAws("aws cloudformation set-stack-policy --stack-name x --stack-policy-body '{}'")).toBe(false));
  it("describe-stacks | python3 (unsafe pipe consumer)", () => {
    expect(
      matchAws(
        `aws cloudformation describe-stacks --stack-name x --output json | python3 -c "import sys,json; print(json.load(sys.stdin))"`,
      ),
    ).toBe(false);
  });
});

describe("matchAws — logs start-query (allow read-only query dispatch)", () => {
  it("start-query with --output text", () => {
    expect(
      matchAws(
        `aws logs start-query --profile drashta-prod --region eu-central-1 --log-group-name "/aws/lambda/DrashtaProdAppStack-TieredProcessorSmallHandlerA33-uVw6AyovyDmX" --start-time 1784181612 --end-time 1784192412 --query-string 'fields @timestamp, @message | filter @message like /out of memory/ | sort @timestamp desc | limit 50' --output text`,
      ),
    ).toBe(true);
  });
  // The real invocations use `\`-newline line continuations; parseCompound treats
  // the newline like `;`, so the multi-line whole-command shape stays rejected —
  // only the single-line coverable shape is approved.
  it("multi-line \\-continuation form stays rejected", () => {
    expect(
      matchAws(
        `aws logs start-query --profile drashta-prod --region eu-central-1 \\\n  --log-group-name "/aws/lambda/x" \\\n  --start-time 1784181612 --end-time 1784192412 \\\n  --query-string 'fields @timestamp, @message' \\\n  --output text`,
      ),
    ).toBe(false);
  });
});

describe("matchAws — cloudwatch (allow read-only)", () => {
  it("list-metrics", () => {
    expect(
      matchAws(
        `aws cloudwatch list-metrics --profile drashta-prod --region eu-central-1 --namespace Kizil --dimensions Name=File,Value=path_actual_cpt --output json`,
      ),
    ).toBe(true);
  });
  it("get-dashboard with --output json", () => {
    expect(
      matchAws(
        `aws cloudwatch get-dashboard --profile drashta-prod --region eu-central-1 --dashboard-name "Kizil--prod--path_actual_cpt" --output json`,
      ),
    ).toBe(true);
  });
  it("get-dashboard | head", () => {
    expect(
      matchAws(
        `aws cloudwatch get-dashboard --dashboard-name "Kizil--prod--path_actual_cpt" --output json | head`,
      ),
    ).toBe(true);
  });
  it("describe-alarms", () => expect(matchAws("aws cloudwatch describe-alarms")).toBe(true));
  it("get-metric-data", () => expect(matchAws("aws cloudwatch get-metric-data --metric-data-queries '[]' --start-time 1 --end-time 2")).toBe(true));
  it("get-metric-statistics", () => expect(matchAws("aws cloudwatch get-metric-statistics --namespace n --metric-name m --start-time 1 --end-time 2 --period 60 --statistics Sum")).toBe(true));
  it("list-dashboards", () => expect(matchAws("aws cloudwatch list-dashboards")).toBe(true));
});

describe("matchAws — cloudwatch (block writes / alarm mutations)", () => {
  it("put-metric-data", () => expect(matchAws("aws cloudwatch put-metric-data --namespace n --metric-data '[]'")).toBe(false));
  it("put-metric-alarm", () => expect(matchAws("aws cloudwatch put-metric-alarm --alarm-name a")).toBe(false));
  it("put-dashboard", () => expect(matchAws("aws cloudwatch put-dashboard --dashboard-name d --dashboard-body '{}'")).toBe(false));
  it("delete-alarms", () => expect(matchAws("aws cloudwatch delete-alarms --alarm-names a")).toBe(false));
  it("delete-dashboards", () => expect(matchAws("aws cloudwatch delete-dashboards --dashboard-names d")).toBe(false));
  it("set-alarm-state", () => expect(matchAws("aws cloudwatch set-alarm-state --alarm-name a --state-value ALARM --state-reason r")).toBe(false));
  it("enable-alarm-actions", () => expect(matchAws("aws cloudwatch enable-alarm-actions --alarm-names a")).toBe(false));
  it("get-dashboard | python3 (unsafe pipe consumer) stays rejected", () => {
    expect(
      matchAws(
        `aws cloudwatch get-dashboard --profile drashta-prod --region eu-central-1 --dashboard-name "Kizil--prod--path_actual_cpt" --output json 2>&1 | python3 -c "import sys,json; d=json.load(sys.stdin); print(d)"`,
      ),
    ).toBe(false);
  });
});

describe("matchAws — account (allow region/contact reads)", () => {
  it("list-regions with query/output flags", () => {
    expect(
      matchAws(
        `aws account list-regions --profile drashta-prod --region-opt-status-contains ENABLED ENABLED_BY_DEFAULT --query 'Regions[].RegionName' --output text`,
      ),
    ).toBe(true);
  });
  it("list-regions | head", () => {
    expect(
      matchAws(
        `aws account list-regions --profile drashta-prod --region-opt-status-contains ENABLED ENABLED_BY_DEFAULT --query 'Regions[].RegionName' --output text 2>&1 | head`,
      ),
    ).toBe(true);
  });
  it("get-region-opt-status", () => expect(matchAws("aws account get-region-opt-status --region-name ap-south-1")).toBe(true));
  it("get-contact-information", () => expect(matchAws("aws account get-contact-information")).toBe(true));
});

describe("matchAws — account (block region opt-in/out & contact writes)", () => {
  it("enable-region", () => expect(matchAws("aws account enable-region --region-name ap-south-1")).toBe(false));
  it("disable-region", () => expect(matchAws("aws account disable-region --region-name ap-south-1")).toBe(false));
  it("put-contact-information", () => expect(matchAws("aws account put-contact-information --contact-information '{}'")).toBe(false));
  it("put-alternate-contact", () => expect(matchAws("aws account put-alternate-contact --alternate-contact-type BILLING")).toBe(false));
  it("delete-alternate-contact", () => expect(matchAws("aws account delete-alternate-contact --alternate-contact-type BILLING")).toBe(false));
});

describe("matchAws — configure (allow local config reads)", () => {
  it("list-profiles", () => expect(matchAws("aws configure list-profiles")).toBe(true));
  it("get region --profile", () => expect(matchAws("aws configure get region --profile drashta-prod")).toBe(true));
  it("list", () => expect(matchAws("aws configure list")).toBe(true));
});

describe("matchAws — configure (block local config writes)", () => {
  it("set (writes a config value)", () => expect(matchAws("aws configure set region us-east-1")).toBe(false));
  it("import (writes credentials)", () => expect(matchAws("aws configure import --csv file://keys.csv")).toBe(false));
  it("add-model (writes a service model file)", () => expect(matchAws("aws configure add-model --service-model file://model.json")).toBe(false));
});

describe("matchAws — block out-of-scope services", () => {
  it("ec2 describe-instances is rejected (service not allowlisted)", () => {
    expect(matchAws("aws ec2 describe-instances")).toBe(false);
  });
  it("secretsmanager get-secret-value is rejected (service not allowlisted)", () => {
    expect(matchAws("aws secretsmanager get-secret-value --secret-id x")).toBe(false);
  });
});

describe("matchAws — block dangerous shapes", () => {
  it("aws with no subcommand", () => {
    expect(matchAws("aws logs")).toBe(false);
  });
  it("bare aws", () => {
    expect(matchAws("aws")).toBe(false);
  });
  it("file redirection", () => {
    expect(matchAws("aws logs describe-log-groups > /tmp/out.json")).toBe(false);
  });
  it("; chained mutation", () => {
    expect(matchAws("aws logs describe-log-groups; aws logs delete-log-group --log-group-name x")).toBe(false);
  });
  it("&& chained non-cd command", () => {
    expect(matchAws("aws logs describe-log-groups && rm -rf /")).toBe(false);
  });
  it("|| operator", () => {
    expect(matchAws("aws logs describe-log-groups || echo fail")).toBe(false);
  });
  it("pipe to a non-safe target", () => {
    expect(matchAws("aws logs describe-log-groups | sh")).toBe(false);
  });
  it("command substitution", () => {
    expect(matchAws("aws logs describe-log-groups --region $(cat /etc/x)")).toBe(false);
  });
  it("not aws", () => {
    expect(matchAws("kubectl get pods")).toBe(false);
  });
  it("empty", () => {
    expect(matchAws("")).toBe(false);
  });
});
