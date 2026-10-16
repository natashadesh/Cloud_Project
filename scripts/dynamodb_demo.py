import boto3

REGION = "us-east-1"
TABLE_NAME = "Learning"


session = boto3.Session(
    region_name=REGION
)

dynamodb = session.resource("dynamodb")

table = dynamodb.Table(TABLE_NAME)

print("Connected to DynamoDB table:", TABLE_NAME)

def create_user(uer_id, display_name, email, score):
    response = table.put_item(
        Item={
            "uer_id": uer_id,
            "display_name": display_name,
            "email": email,
            "score": score
        }
    )

    print("Created user:", uer_id)
    return response


def get_user(uer_id):
    response = table.get_item(
        Key={
            "uer_id": uer_id
        }
    )

    user = response.get("Item")

    if user:
        print("Found user:")
        print(user)
    else:
        print("User not found")

    return user


def update_score(uer_id, new_score):
    response = table.update_item(
        Key={
            "uer_id": uer_id
        },
        UpdateExpression="SET score = :score",
        ExpressionAttributeValues={
            ":score": new_score
        },
        ReturnValues="ALL_NEW"
    )

    updated_user = response["Attributes"]

    print("Updated user:")
    print(updated_user)

    return updated_user

def list_users():
    response = table.scan()

    users = response.get("Items", [])

    print("Users:")

    for user in users:
        print(user)

    return users

def delete_user(uer_id):
    response = table.delete_item(
        Key={
            "uer_id": uer_id
        },
        ReturnValues="ALL_OLD"
    )

    deleted_user = response.get("Attributes")

    print("Deleted:")
    print(deleted_user)

    return deleted_user

def main():

    create_user(
        uer_id="u001",
        display_name="Alice",
        email="alice@example.com",
        score=10
    )

    get_user("u001")

    update_score("u001", 25)

    list_users()

if __name__ == "__main__":
    main()