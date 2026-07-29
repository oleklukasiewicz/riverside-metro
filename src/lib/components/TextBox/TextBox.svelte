<script lang="ts">
  //icons
  interface BaseProps {
    disabled?: boolean;
  }

  interface TextBoxProps extends BaseProps {
    value?: string;
    placeholder?: string;
    oninput?: (event?: any) => void;
  }

  let {
    value = $bindable(""),
    placeholder = "",
    disabled = false,
    oninput = () => {},
  }: TextBoxProps = $props();

  const handleInput = (event: any) => {
    oninput?.({ value: event.target.value });
  };
  const clear = () => {
    value = "";
    oninput?.({ value: "" });
  };
</script>

<div class="text-box">
  <input bind:value oninput={handleInput} {placeholder} class:disabled />
</div>

<style lang="scss">
  @import "TextBox.scss";
</style>
