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

describe("matchAws — block out-of-scope services", () => {
  it("ec2 describe-instances is rejected (service not allowlisted)", () => {
    expect(matchAws("aws ec2 describe-instances")).toBe(false);
  });
  it("iam list-users is rejected (service not allowlisted)", () => {
    expect(matchAws("aws iam list-users")).toBe(false);
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
